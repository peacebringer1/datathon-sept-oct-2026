import json
import unittest
from unittest.mock import patch

from DataHackathon.frontend import app as app_module


class AILanguageTests(unittest.TestCase):
    def setUp(self):
        app_module.app.config['TESTING'] = True
        self.client = app_module.app.test_client()
        self.api_key = patch.object(app_module, 'CLAUDE_API_KEY', 'sk-ant-test')
        self.api_key.start()
        self.addCleanup(self.api_key.stop)

    def test_chat_passes_selected_language_to_claude(self):
        with patch.object(app_module, 'get_dataset_overview', return_value={}), patch.object(
            app_module,
            'call_claude',
            return_value={'answer': 'Hello', 'chart': None}
        ) as call_claude:
            response = self.client.post('/api/ai-chat', json={
                'messages': [{'role': 'user', 'text': 'Summarize the chart'}],
                'language': 'en'
            })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(call_claude.call_args.kwargs['response_language'], 'en')

    def test_chart_analysis_passes_selected_language_to_claude(self):
        analysis = {
            'trend': 'The value increased.',
            'observations': ['The value reached 10.'],
            'hypotheses': ['This may reflect a change.', 'Further data is needed.']
        }
        with patch.object(app_module, 'get_dataset_overview', return_value={}), patch.object(
            app_module, 'call_claude', return_value=json.dumps(analysis)
        ) as call_claude:
            response = self.client.post('/api/chart-analysis', json={
                'indicator': 'Population',
                'category': 'Demographics',
                'year': '2024',
                'language': 'en',
                'chart': {
                    'labels': ['Astana'],
                    'series': [{
                        'name': 'Population',
                        'type': 'bar',
                        'points': [{'label': 'Astana', 'value': 10}]
                    }]
                }
            })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(call_claude.call_args.kwargs['response_language'], 'en')

    def test_rejects_unsupported_response_language(self):
        response = self.client.post('/api/ai-chat', json={
            'messages': [{'role': 'user', 'text': 'Hello'}],
            'language': 'fr'
        })

        self.assertEqual(response.status_code, 400)

