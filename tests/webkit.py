"""Run the browser harness in the same WebKitGTK engine as ASE Studio.

Start ASE_TEST_SERVE_ONLY=1 npm run test:browser, then pass its harness URL here.
Requires a graphical session and ASE Studio's normal GTK dependencies.
"""
import json
import sys
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, GLib, WebKit2

window = Gtk.Window(title='ASE Studio — Monaco verification')
window.set_default_size(1000, 720)
view = WebKit2.WebView()
window.add(view)
status = 1
started = False
finished = False


def evaluate(script, callback):
    def done(webview, result, _data):
        try:
            callback(webview.evaluate_javascript_finish(result).to_string())
        except GLib.Error as error:
            print(error, file=sys.stderr)
            Gtk.main_quit()
    view.evaluate_javascript(script, -1, None, None, None, done, None)


def poll():
    evaluate("JSON.stringify({ready:!!window.harness?.ready,done:!!window.harness?.done,error:window.testError,results:window.harness?.results})", receive)
    return not finished


def receive(value):
    global started, status, finished
    data = json.loads(value)
    if data.get('error'):
        print(data['error'], file=sys.stderr)
        finished = True
        Gtk.main_quit()
    elif data['done']:
        for result in data['results']:
            print('PASS WebKitGTK:', result)
        status = 0
        finished = True
        Gtk.main_quit()
    elif data['ready'] and not started:
        started = True
        evaluate("window.runEditorTests().catch(e=>window.testError=String(e)); 'started'", lambda _: None)


def timeout():
    print('WebKitGTK test timed out', file=sys.stderr)
    Gtk.main_quit()
    return False

view.load_uri(sys.argv[1])
window.show_all()
GLib.timeout_add(250, poll)
GLib.timeout_add_seconds(45, timeout)
Gtk.main()
window.destroy()
sys.exit(status)
