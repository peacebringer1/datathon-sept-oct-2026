const langs = ['ru', 'kk', 'en'];
let currentLangIndex = 0;
const apiKey = 'ВАШ_GOOGLE_CLOUD_API_КЛЮЧ';

async function toggleLanguage() {
  currentLangIndex = (currentLangIndex + 1) % langs.length;
  const targetLang = langs[currentLangIndex];

  const btn = document.getElementById('langToggleBtn');
  if (btn) {
    btn.innerText = targetLang.toUpperCase();
  }

  await translatePageElements(targetLang);
}

async function translatePageElements(targetLang) {
  if (targetLang === 'ru') {
    window.location.reload();
    return;
  }

  const elements = document.querySelectorAll(
    'h2, .sidebar-title-text, .cat-text, .subcat-item, label, .tab-btn, th, td, .chat-bubble, span, button'
  );

  for (let el of elements) {
    if (el.children.length === 0 && el.innerText.trim() !== '') {
      const original = el.getAttribute('data-original') || el.innerText;
      if (!el.getAttribute('data-original')) {
        el.setAttribute('data-original', original);
      }

      const translated = await callGoogleTranslateAPI(original, targetLang);
      if (translated) {
        el.innerText = translated;
      }
    }
  }
}

async function callGoogleTranslateAPI(text, targetLang) {
  const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: text,
        source: 'ru',
        target: targetLang,
        format: 'text'
      })
    });
    
    const data = await response.json();
    if (data && data.data && data.data.translations && data.data.translations[0]) {
      return data.data.translations[0].translatedText;
    }
  } catch (error) {
    console.error(error);
  }
  
  return text;
}