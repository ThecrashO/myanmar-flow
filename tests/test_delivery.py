"""Test dictation delivery without a microphone, tray, or system clipboard."""
import ast
from datetime import datetime
from pathlib import Path
from threading import RLock
from types import SimpleNamespace
import unittest
from unittest.mock import Mock


def delivery_functions(platform):
    source_path = Path(__file__).resolve().parents[1] / "crash_flow.py"
    tree = ast.parse(source_path.read_text(encoding="utf-8"))
    app = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "App")
    paste = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "paste_text")
    deliver = next(node for node in app.body if isinstance(node, ast.FunctionDef) and node.name == "deliver_result")
    scope = {
        "plat": platform, "time": SimpleNamespace(sleep=Mock()), "log": Mock(),
        "datetime": datetime, "SAMPLE_RATE": 16000, "PASTE_KEYS": "Ctrl+V",
    }
    exec(compile(ast.Module(body=[paste, deliver], type_ignores=[]), str(source_path), "exec"), scope)
    return scope["deliver_result"]


class DeliveryTest(unittest.TestCase):
    def setUp(self):
        self.platform = Mock()
        self.platform.foreground_window.return_value = 17
        self.deliver = delivery_functions(self.platform)
        self.app = SimpleNamespace(
            lock=RLock(), enabled=True, session=2, history=[], update_menu=Mock(),
            cfg={"keep_in_clipboard": True}, stats=Mock(), set_state=Mock(),
        )

    def test_stale_and_disabled_results_are_available_only_in_history(self):
        self.deliver(self.app, "older result", None, 16000, 1, 17)
        self.app.enabled = False
        self.deliver(self.app, "late result", None, 16000, 2, 17)
        self.platform.copy_text.assert_not_called()
        self.platform.send_paste.assert_not_called()
        self.app.set_state.assert_not_called()
        self.assertEqual([text for _, text in self.app.history], ["older result", "late result"])

    def test_focus_changes_before_paste(self):
        self.platform.foreground_window.side_effect = [17, 21]
        self.deliver(self.app, "transcript", None, 16000, 2, 17)
        self.platform.send_paste.assert_not_called()
        self.app.set_state.assert_called_once()
        self.assertEqual(self.app.history[0][1], "transcript")
        self.app.stats.add.assert_not_called()

    def test_current_result_pastes_into_original_window(self):
        self.deliver(self.app, "transcript", None, 16000, 2, 17)
        self.platform.send_paste.assert_called_once()
        self.app.stats.add.assert_called_once_with(10, 1)

    def test_clipboard_error_leaves_history_and_clears_spinner(self):
        self.platform.copy_text.side_effect = RuntimeError("Clipboard busy")
        self.deliver(self.app, "transcript", None, 16000, 2, 17)
        self.app.set_state.assert_called_once()
        self.assertEqual(self.app.set_state.call_args.args[0], "done")
        self.assertEqual(self.app.history[0][1], "transcript")


if __name__ == "__main__":
    unittest.main()
