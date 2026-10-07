"""Бэкенд Data Analyzer для встраивания в Electron.
Запуск: python server.py [порт]   (положить рядом с папкой core/ из Data Analyzer)
"""
import dataclasses, json, math, os, sqlite3, sys, tempfile, uuid
import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, FileResponse

from core.loader import load_dataset
from core.cleaner import CleaningOptions, clean_dataset
from core.profiler import profile_dataset
from core.decodings import DecodingRule, unique_value_counts
from core.transformations import CoalesceRule, coalesce_columns, combine_columns
from core.merger import JoinRelation, merge_datasets, column_pair_overlap, common_columns

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
DEMOGRAPHICS_DB = os.path.join(PROJECT_DIR, "database.sqlite")
TMP = tempfile.mkdtemp(prefix="da_")
DS: dict[str, dict] = {}  # id -> {name, raw, clean, report}


@app.get("/", include_in_schema=False)
def analyzer_ui():
    return FileResponse(os.path.join(PROJECT_DIR, "index.html"))


def clean_json(o):
    if isinstance(o, float) and (math.isnan(o) or math.isinf(o)):
        return None
    if isinstance(o, dict):
        return {k: clean_json(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean_json(v) for v in o]
    return o


def js(data):
    return Response(json.dumps(clean_json(data), default=str, ensure_ascii=False), media_type="application/json")


def get(i):
    if i not in DS:
        raise HTTPException(404, "Датасет не найден")
    return DS[i]


def current(d):
    return d["clean"] if d["clean"] is not None else d["raw"]


@app.post("/api/datasets")
async def upload(request: Request, name: str):
    path = os.path.join(TMP, uuid.uuid4().hex + "_" + os.path.basename(name))
    with open(path, "wb") as f:
        f.write(await request.body())
    try:
        ds = load_dataset(path)
    except Exception as e:
        raise HTTPException(400, str(e))
    i = uuid.uuid4().hex[:8]
    DS[i] = {"name": name, "raw": ds.dataframe, "clean": None, "report": None,
             "meta": {"encoding": ds.encoding, "separator": ds.separator_display}}
    return js(info(i))


@app.post("/api/datasets/from-demographics")
def import_demographics():
    if not os.path.isfile(DEMOGRAPHICS_DB):
        raise HTTPException(404, "База демографии database.sqlite не найдена")

    try:
        conn = sqlite3.connect(f"file:{DEMOGRAPHICS_DB}?mode=ro", uri=True)
        try:
            table_exists = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                ("demographics",),
            ).fetchone()
            if table_exists is None:
                raise HTTPException(404, "В базе нет таблицы demographics")
            df = pd.read_sql_query(
                "SELECT indicator, year, province, value FROM demographics",
                conn,
            )
        finally:
            conn.close()
    except sqlite3.Error as error:
        raise HTTPException(500, f"Не удалось прочитать базу демографии: {error}") from error

    if df.empty:
        raise HTTPException(404, "Таблица demographics пуста")

    dataset_id = next(
        (key for key, dataset in DS.items() if dataset.get("source") == "demographics"),
        None,
    )
    if dataset_id is None:
        dataset_id = uuid.uuid4().hex[:8]

    DS[dataset_id] = {
        "name": "Демография — данные из database.sqlite",
        "raw": df,
        "clean": None,
        "report": None,
        "source": "demographics",
        "meta": {"encoding": "SQLite", "separator": "—"},
    }
    return js(info(dataset_id))


def info(i):
    d = DS[i]
    df = current(d)
    return {"id": i, "name": d["name"], "rows": len(df), "cols": len(df.columns),
            "cleaned": d["clean"] is not None, **d["meta"]}


@app.get("/api/datasets")
def list_ds():
    return js([info(i) for i in DS])


@app.delete("/api/datasets/{i}")
def delete(i: str):
    DS.pop(i, None)
    return js({"ok": True})


@app.get("/api/datasets/{i}/profile")
def profile(i: str):
    p = profile_dataset(current(get(i)))
    return js(dataclasses.asdict(p))


@app.get("/api/datasets/{i}/data")
def data(i: str, offset: int = 0, limit: int = 100):
    df = current(get(i))
    part = df.iloc[offset: offset + limit]
    rows = part.astype(object).where(part.notna(), None).values.tolist()
    return js({"columns": list(df.columns), "rows": rows, "total": len(df)})


@app.get("/api/datasets/{i}/dashboard-data")
def dashboard_data(i: str):
    df = current(get(i))
    aliases = {
        "indicator": {"indicator", "показатель", "көрсеткіш"},
        "year": {"year", "год", "жыл"},
        "province": {"province", "region", "область", "регион", "territory", "территория", "аймақ"},
        "value": {"value", "значение", "количество", "amount", "count", "мөлшері"},
    }
    column_by_field = {}
    for column in df.columns:
        normalized = "".join(char for char in str(column).casefold() if char.isalnum())
        for field, names in aliases.items():
            if normalized in names:
                column_by_field.setdefault(field, column)

    if len(df) > 50000:
        raise HTTPException(413, "Для передачи в дашборд датасет должен содержать не более 50 000 строк.")

    if not ({"indicator", "year", "province", "value"} - column_by_field.keys()):
        records = []
        for indicator, year, province, value in df[
            [column_by_field[field] for field in ("indicator", "year", "province", "value")]
        ].itertuples(index=False, name=None):
            try:
                year_number = int(float(year))
                value_number = float(value)
            except (TypeError, ValueError, OverflowError):
                continue
            if not math.isfinite(value_number):
                continue
            records.append({
                "indicator": "" if pd.isna(indicator) else str(indicator),
                "year": year_number,
                "province": "" if pd.isna(province) else str(province),
                "value": value_number,
            })
        mode = "regional"
    else:
        year_column = column_by_field.get("year")
        if year_column is None:
            for column in df.columns:
                normalized = "".join(char for char in str(column).casefold() if char.isalnum())
                if normalized in {"godo", "godokonchaniya", "yearofcompletion", "yearofsurvey"}:
                    year_column = column
                    break
        if year_column is None:
            for column in df.columns:
                numeric = pd.to_numeric(df[column], errors="coerce").dropna()
                if not numeric.empty and numeric.between(1900, 2100).mean() >= 0.95:
                    year_column = column
                    break

        excluded_columns = {column for column in column_by_field.values()}
        if year_column is not None:
            excluded_columns.add(year_column)
        metrics = []
        for column in df.columns:
            normalized = "".join(char for char in str(column).casefold() if char.isalnum())
            if column in excluded_columns or any(
                normalized == token or normalized.startswith(token)
                for token in ("uuid", "identifier", "nomer", "nomr", "number", "код", "code", "id")
            ):
                continue
            numeric = pd.to_numeric(df[column], errors="coerce")
            if numeric.notna().any():
                metrics.append((column, numeric))

        if not metrics:
            raise HTTPException(
                400,
                "В выбранном датасете не найдено числовых столбцов для построения графиков.",
            )

        records = []
        for column, numeric in metrics:
            counts = {}
            for index, value in numeric.items():
                if pd.isna(value) or not math.isfinite(float(value)):
                    continue
                year = 0
                if year_column is not None:
                    try:
                        candidate = int(float(df.at[index, year_column]))
                        if 1900 <= candidate <= 2100:
                            year = candidate
                    except (TypeError, ValueError, OverflowError):
                        pass
                answer = f"{float(value):g}"
                key = (year, answer)
                counts[key] = counts.get(key, 0) + 1
            records.extend({
                "indicator": str(column),
                "year": year,
                "province": answer,
                "value": count,
            } for (year, answer), count in counts.items())
        mode = "distribution"

    if not records:
        raise HTTPException(400, "В выбранном датасете нет подходящих значений для построения графиков.")
    if len(records) > 50000:
        raise HTTPException(
            413,
            "После обработки для графиков получилось больше 50 000 групп. Удалите лишние идентификаторы или выберите другой датасет.",
        )
    return js({"name": get(i)["name"], "mode": mode, "rows": records})


@app.get("/api/datasets/{i}/chart")
def chart_data(
    i: str,
    x: str,
    y: str,
    aggregation: str = "sum",
    limit: int = 40,
    filter_column: str = "",
    filter_value: str = "",
):
    if aggregation not in {"sum", "mean"}:
        raise HTTPException(400, "Агрегация должна быть sum или mean")
    if limit < 1 or limit > 100:
        raise HTTPException(400, "Лимит категорий должен быть от 1 до 100")

    df = current(get(i))
    if x not in df.columns or y not in df.columns:
        raise HTTPException(400, "Выбранный столбец не найден")
    if filter_column and filter_column not in df.columns:
        raise HTTPException(400, "Столбец фильтра не найден")
    if filter_column and filter_value:
        df = df[df[filter_column].astype(str) == filter_value]

    values = pd.to_numeric(df[y], errors="coerce")
    chart_frame = pd.DataFrame({
        "label": df[x].astype("string").fillna("(пусто)"),
        "value": values,
    }).dropna(subset=["value"])
    if chart_frame.empty:
        raise HTTPException(400, "В выбранном столбце нет числовых значений для графика")

    grouped = chart_frame.groupby("label", sort=False)["value"]
    aggregated = grouped.sum() if aggregation == "sum" else grouped.mean()
    if pd.api.types.is_numeric_dtype(df[x]):
        aggregated = aggregated.sort_index(key=lambda labels: pd.to_numeric(labels, errors="coerce"))
    elif len(aggregated) > limit:
        aggregated = aggregated.sort_values(ascending=False)
    aggregated = aggregated.head(limit)

    return js({
        "x": x,
        "y": y,
        "aggregation": aggregation,
        "filter_column": filter_column,
        "filter_value": filter_value,
        "labels": aggregated.index.astype(str).tolist(),
        "values": aggregated.tolist(),
    })


@app.post("/api/datasets/{i}/clean")
async def clean(i: str, request: Request):
    d = get(i)
    o = await request.json()
    opts = CleaningOptions(
        missing_mode=o.get("missing_mode", "keep"),
        fill_value=o.get("fill_value", "Не указано"),
        duplicate_mode=o.get("duplicate_mode", "none"),
        duplicate_columns=o.get("duplicate_columns", []),
        drop_empty_columns=o.get("drop_empty_columns", True),
        decoding_rules=[DecodingRule(r["column"], r.get("match_type", "exact"), str(r.get("value_from", "")),
                                     str(r.get("value_to", "")), str(r.get("replacement", "")))
                        for r in o.get("decoding_rules", [])],
    )
    ov = {c: "Категориальный" for c in o.get("categorical_columns", [])}
    try:
        df, _, rep = clean_dataset(d["raw"], opts, compute_profile=False, column_type_overrides=ov)
    except Exception as e:
        raise HTTPException(400, str(e))
    d["clean"] = df
    d["rules"] = o.get("decoding_rules", [])
    r = dataclasses.asdict(rep)
    r.pop("pre_duplicate_profile", None)
    r["columns"] = [c for c in r["columns"] if c["action"] != "no_change"]
    d["report"] = r
    return js({"info": info(i), "report": r})


@app.post("/api/datasets/{i}/reset")
def reset(i: str):
    d = get(i)
    d["clean"], d["report"] = None, None
    return js(info(i))


@app.get("/api/datasets/{i}/export")
def export(i: str):
    d = get(i)
    csv = current(d).to_csv(index=False, encoding="utf-8-sig")
    fn = os.path.splitext(d["name"])[0] + "_cleaned.csv"
    return Response(csv.encode("utf-8-sig"),
                    media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fn}"})


@app.get("/api/datasets/{i}/unique")
def unique(i: str, column: str):
    try:
        return js(unique_value_counts(current(get(i)), column, limit=2000).values.tolist())
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/datasets/{i}/columns")
def columns(i: str):
    df = current(get(i))
    return js([{"name": c, "dtype": str(df[c].dtype)} for c in df.columns])


@app.post("/api/datasets/{i}/rename")
async def rename(i: str, request: Request):
    d = get(i)
    m = {k: v.strip() for k, v in (await request.json()).items() if v.strip() and v.strip() != k}
    df = current(d)
    new = [m.get(c, c) for c in df.columns]
    if len(set(new)) != len(new):
        raise HTTPException(400, "Имена столбцов должны быть уникальными")
    df = df.copy()
    df.columns = new
    d["clean"] = df
    return js(info(i))


@app.post("/api/datasets/{i}/combine")
async def combine(i: str, request: Request):
    d = get(i)
    o = await request.json()
    try:
        r = combine_columns(current(d), o["columns"], o["new_column"],
                            separator=o.get("separator", " "), skip_empty=o.get("skip_empty", True))
    except Exception as e:
        raise HTTPException(400, str(e))
    d["clean"] = r.dataframe
    return js({"info": info(i), "removed": r.removed_columns, "new_column": r.new_column})


@app.post("/api/datasets/{i}/coalesce")
async def coalesce(i: str, request: Request):
    d = get(i)
    o = await request.json()
    try:
        r = coalesce_columns(current(d), [CoalesceRule(x["columns"], x["new_column"]) for x in o["rules"]])
    except Exception as e:
        raise HTTPException(400, str(e))
    d["clean"] = r.dataframe
    return js({"info": info(i), "rules": [dataclasses.asdict(x) for x in r.rules]})


@app.get("/api/overlap")
def overlap(a: str, col_a: str, b: str, col_b: str):
    try:
        o = column_pair_overlap(current(get(a))[col_a], current(get(b))[col_b])
    except Exception as e:
        raise HTTPException(400, str(e))
    return js(dataclasses.asdict(o))


@app.get("/api/common-columns")
def common(ids: str):
    return js(common_columns([current(get(x)) for x in ids.split(",")]))


@app.post("/api/merge")
async def merge(request: Request):
    o = await request.json()
    ids = o["ids"]  # ids[0]... все выбранные датасеты; base = o["base"]
    base = ids.index(o["base"])
    rels = [JoinRelation(ids.index(r["dataset"]), r["base_column"], r["other_column"], r.get("how", "inner"))
            for r in o["relations"]]
    try:
        df, rep = merge_datasets([current(get(x)) for x in ids], [get(x)["name"] for x in ids], base, rels,
                                 allow_many_to_many=o.get("allow_many_to_many", False))
    except Exception as e:
        raise HTTPException(400, str(e))
    i = uuid.uuid4().hex[:8]
    DS[i] = {"name": "merged_" + get(o["base"])["name"], "raw": df, "clean": None, "report": None,
             "meta": {"encoding": None, "separator": "—"}}
    r = dataclasses.asdict(rep)
    r["cardinality"] = [{**c, "type": ("N:M" if c["many_to_many_keys"] else "N:1" if c["base_duplicate_rows"] and c["matched_keys"]
                                        else "1:N" if c["other_duplicate_rows"] and c["matched_keys"] else "1:1")}
                        for c in r["cardinality"]]
    return js({"info": info(i), "report": r})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[1]) if len(sys.argv) > 1 else 8765)
