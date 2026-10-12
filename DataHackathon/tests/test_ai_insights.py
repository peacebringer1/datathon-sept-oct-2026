import json
import unittest
from unittest.mock import MagicMock, patch

from DataHackathon.frontend import app as app_module


class AIInsightsTests(unittest.TestCase):
    def setUp(self):
        app_module.AI_INSIGHTS_CACHE.clear()
        app_module.app.config['TESTING'] = True
        self.client = app_module.app.test_client()
        self.settings = patch.multiple(
            app_module,
            CLAUDE_API_KEY='sk-ant-test',
            ACTIVE_DEMOGRAPHICS=None,
            ACTIVE_DATASET_NAME=None,
            ACTIVE_DATASET_MODE=None
        )
        self.settings.start()
        self.addCleanup(self.settings.stop)
        self.addCleanup(app_module.AI_INSIGHTS_CACHE.clear)

    def mock_database(self, rows):
        connection = MagicMock()
        connection.execute.return_value.fetchall.return_value = rows
        return patch.object(app_module, 'get_db_connection', return_value=connection)

    def test_calls_claude_with_aggregated_database_facts_and_caches_validated_result(self):
        rows = [
            {'province': 'Астана', 'year': 2023, 'value': 10.0},
            {'province': 'Астана', 'year': 2024, 'value': 15.0}
        ]
        response_text = json.dumps({
            'insights': [{
                'type': 'positive',
                'title': 'Рост',
                'badge': '2023–2024',
                'text': 'Значение выросло с 10 до 15.'
            }]
        }, ensure_ascii=False)
        with self.mock_database(rows), patch.object(
            app_module, 'call_claude', return_value=response_text
        ) as call_claude:
            first = self.client.get('/api/ai-insights?indicator=Population')
            second = self.client.get('/api/ai-insights?indicator=Population')

        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.get_json()['insights'][0]['title'], 'Рост')
        self.assertFalse(first.get_json()['cached'])
        self.assertTrue(second.get_json()['cached'])
        call_claude.assert_called_once()
        call = call_claude.call_args
        self.assertFalse(call.kwargs['include_tools'])
        prompt = call.args[0][0]['parts'][0]['text']
        self.assertIn('"value": 10.0', prompt)
        self.assertIn('"value": 15.0', prompt)

    def test_returns_clear_error_when_api_key_is_missing(self):
        with patch.object(app_module, 'CLAUDE_API_KEY', ''):
            response = self.client.get('/api/ai-insights?indicator=Population')

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()['error']['code'], 'missing_key')

    def test_returns_error_for_malformed_claude_response(self):
        with self.mock_database([{'province': 'Астана', 'year': 2024, 'value': 15.0}]), patch.object(
            app_module, 'call_claude', return_value='not JSON'
        ):
            response = self.client.get('/api/ai-insights?indicator=Population')

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()['error']['code'], 'ai_service_error')
        self.assertFalse(app_module.AI_INSIGHTS_CACHE)

    def test_uses_selected_language_and_keeps_localized_results_separate_in_cache(self):
        app_module.ACTIVE_DEMOGRAPHICS = [
            {'indicator': 'Population', 'province': 'Астана', 'year': 2024, 'value': 15.0}
        ]
        response_text = json.dumps({
            'insights': [{
                'type': 'neutral',
                'title': 'Observation',
                'badge': '2024',
                'text': 'The value is 15.'
            }]
        })
        with patch.object(app_module, 'call_claude', return_value=response_text) as call_claude:
            english = self.client.get('/api/ai-insights?indicator=Population&language=en')
            kazakh = self.client.get('/api/ai-insights?indicator=Population&language=kk')

        self.assertEqual(english.status_code, 200)
        self.assertEqual(kazakh.status_code, 200)
        self.assertEqual(call_claude.call_count, 2)
        self.assertEqual(call_claude.call_args_list[0].kwargs['response_language'], 'en')
        self.assertEqual(call_claude.call_args_list[1].kwargs['response_language'], 'kk')

    def test_uses_active_dataset_and_passes_only_matching_aggregates(self):
        active_rows = [
            {'indicator': 'Population', 'province': 'Астана', 'year': 2024, 'value': 10.0},
            {'indicator': 'Population', 'province': 'Алматы', 'year': 2024, 'value': 5.0},
            {'indicator': 'Other', 'province': 'Астана', 'year': 2024, 'value': 999.0}
        ]
        app_module.ACTIVE_DEMOGRAPHICS = active_rows
        app_module.ACTIVE_DATASET_NAME = 'локальный набор'
        response_text = json.dumps({
            'insights': [{
                'type': 'neutral',
                'title': 'Значение',
                'badge': '2024',
                'text': 'Сумма по региону составляет 15.'
            }]
        }, ensure_ascii=False)
        with patch.object(app_module, 'call_claude', return_value=response_text) as call_claude:
            response = self.client.get('/api/ai-insights?indicator=Population')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['source'], 'локальный набор')
        prompt = call_claude.call_args.args[0][0]['parts'][0]['text']
        self.assertIn('"value": 10.0', prompt)
        self.assertIn('"value": 5.0', prompt)
        self.assertNotIn('999.0', prompt)

    def test_rejects_duplicate_region_year_values_without_aggregation(self):
        rows = [
            {'province': 'Астана', 'year': 2024, 'value': 10.0},
            {'province': 'Астана', 'year': 2024, 'value': 5.0}
        ]
        with self.mock_database(rows), patch.object(app_module, 'call_claude') as call_claude:
            response = self.client.get('/api/ai-insights?indicator=Population')

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()['error']['code'], 'duplicate_observations')
        call_claude.assert_not_called()

    def test_returns_upstream_error_without_success_shaped_result(self):
        with self.mock_database([{'province': 'Астана', 'year': 2024, 'value': 15.0}]), patch.object(
            app_module,
            'call_claude',
            side_effect=app_module.ClaudeAPIError('Claude API недоступен')
        ):
            response = self.client.get('/api/ai-insights?indicator=Population')

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()['error']['code'], 'claude_api_error')
        self.assertNotIn('insights', response.get_json())


if __name__ == '__main__':
    unittest.main()
