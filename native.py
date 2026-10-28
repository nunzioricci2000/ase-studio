#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Behnam Farnaghinejad <behnam.farnaghinejad@polito.it>
# SPDX-License-Identifier: GPL-2.0-only
# Modified in the personal fork on 2026-10-27: name the application ASE Studio di Nunzio.
# Modified in the personal fork on 2026-10-28: verify native startup and shutdown with isolated packaged-runtime data.
from __future__ import annotations

import argparse
import gc
import json
import os
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gio, GLib, Gtk, WebKit2  # noqa: E402

STUDIO_ROOT = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("ASE_STUDIO_HOST_ROOT", STUDIO_ROOT.parent)).resolve()
APPLICATION_NAME = "ASE Studio di Nunzio"
APPLICATION_ID = "org.asestudio.Personal"
WM_CLASS = "ASEStudioFork"
ICON_PATH = STUDIO_ROOT / "frontend" / "icon.png"
if str(STUDIO_ROOT) not in sys.path:
    sys.path.insert(0, str(STUDIO_ROOT))

from backend import Handler, validate_runtime_environment, terminate_active_commands  # noqa: E402
from http.server import ThreadingHTTPServer  # noqa: E402


def create_server(preferred_port: int) -> ThreadingHTTPServer:
    try:
        return ThreadingHTTPServer(("127.0.0.1", preferred_port), Handler)
    except OSError:
        return ThreadingHTTPServer(("127.0.0.1", 0), Handler)


def main() -> int:
    parser = argparse.ArgumentParser(description="ASE Studio native window")
    parser.add_argument("port", nargs="?", type=int, default=8765)
    parser.add_argument("--development", action="store_true",
                        help="Compatibility option; all launches preserve the current branches")
    parser.add_argument('--smoke-report', type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    GLib.set_prgname(WM_CLASS)
    GLib.set_application_name(APPLICATION_NAME)
    if ICON_PATH.exists():
        Gtk.Window.set_default_icon_from_file(str(ICON_PATH))
    try:
        validate_runtime_environment()
    except ValueError as error:
        message, _status = error.args[0]
        print(message, file=sys.stderr)
        dialog = Gtk.MessageDialog(
            modal=True,
            message_type=Gtk.MessageType.ERROR,
            buttons=Gtk.ButtonsType.CLOSE,
            text="Simulator runtime unavailable",
        )
        dialog.set_title(f"{APPLICATION_NAME} startup")
        dialog.format_secondary_text(message)
        dialog.run()
        dialog.destroy()
        return 1
    preferred_port = args.port

    flags = Gio.ApplicationFlags.NON_UNIQUE if args.smoke_report else Gio.ApplicationFlags.FLAGS_NONE
    application = Gtk.Application(application_id=APPLICATION_ID, flags=flags)
    smoke_started = time.monotonic()
    smoke_timestamp = datetime.now(timezone.utc).isoformat(timespec='milliseconds')
    smoke_passed = False
    smoke_finished = False
    server = None
    server_thread = None
    window = None
    view = None
    memory_window = None
    memory_view = None
    memory_policy_handler = None
    create_handler = None
    closing = False
    ui_destroyed = False

    def activate(app):
        nonlocal server, server_thread, window, view, memory_window
        nonlocal memory_view, memory_policy_handler, create_handler
        nonlocal closing, ui_destroyed
        nonlocal smoke_passed, smoke_finished
        if window is not None:
            window.present()
            return

        # Keep the application loop alive while WebKit is explicitly torn
        # down. Otherwise destroying the last window can end the loop before
        # WebKitGTK has released its page and signal handlers.
        app.hold()
        server = create_server(preferred_port)
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()

        window = Gtk.ApplicationWindow(application=app, title=APPLICATION_NAME)
        # GLib.set_prgname supplies ASEStudioFork as the X11 WM_CLASS. The GTK
        # application ID supplies the corresponding Wayland application ID.
        window.set_default_size(1440, 900)
        window.set_size_request(900, 600)
        if ICON_PATH.exists():
            window.set_icon_from_file(str(ICON_PATH))

        view = WebKit2.WebView()
        view.get_settings().set_property("enable-developer-extras", False)
        # Modified in the personal fork on 2026-10-28: diagnose installed-page startup on disposable displays without a GPU.
        if args.smoke_report:
            view.get_settings().set_property("enable-write-console-messages-to-stdout", True)
            view.get_settings().set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.NEVER)
            view.connect('load-failed', lambda _view, event, uri, error:
                         print(f'Native page load failed: {uri}: {error}', flush=True) or False)
            view.connect('web-process-terminated', lambda _view, reason:
                         print(f'Native web process terminated: {reason}', flush=True))

        def open_external_links(_view, decision, decision_type):
            if decision_type not in {
                    WebKit2.PolicyDecisionType.NAVIGATION_ACTION,
                    WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION}:
                return False
            navigation = decision.get_navigation_action()
            uri = navigation.get_request().get_uri()
            if (uri.startswith(("https://", "http://", "mailto:"))
                    and not uri.startswith("http://127.0.0.1:")):
                decision.ignore()
                Gio.AppInfo.launch_default_for_uri(uri, None)
                return True
            return False

        policy_handler = view.connect("decide-policy", open_external_links)

        def destroy_memory_window():
            nonlocal memory_window, memory_view, memory_policy_handler
            doomed_view = memory_view
            doomed_window = memory_window
            memory_view = None
            memory_window = None
            if doomed_view is not None:
                if memory_policy_handler is not None:
                    doomed_view.disconnect(memory_policy_handler)
                memory_policy_handler = None
                doomed_view.stop_loading()
                parent = doomed_view.get_parent()
                if parent is not None:
                    parent.remove(doomed_view)
                doomed_view.destroy()
            if doomed_window is not None:
                doomed_window.destroy()

        def close_memory_window(*_args):
            destroy_memory_window()
            return True

        def create_memory_window(source_view, _navigation_action):
            nonlocal memory_window, memory_view, memory_policy_handler
            if memory_window is not None and memory_view is not None:
                memory_window.present()
                return memory_view

            memory_window = Gtk.ApplicationWindow(
                application=app, title=f"{APPLICATION_NAME} — Memory")
            memory_window.set_default_size(1050, 720)
            memory_window.set_size_request(650, 400)
            if ICON_PATH.exists():
                memory_window.set_icon_from_file(str(ICON_PATH))

            # A related WebView shares the existing WebKit context and web
            # process. The pop-out is therefore a view of the same running
            # studio, not a second frontend or simulator instance.
            memory_view = WebKit2.WebView.new_with_related_view(source_view)
            memory_view.get_settings().set_property(
                "enable-developer-extras", False)
            memory_policy_handler = memory_view.connect(
                "decide-policy", open_external_links)
            memory_view.connect("close", close_memory_window)
            memory_window.connect("delete-event", close_memory_window)
            memory_window.add(memory_view)
            memory_window.show_all()
            return memory_view

        create_handler = view.connect("create", create_memory_window)

        def choose_download_destination(download, suggested_filename):
            dialog = Gtk.FileChooserDialog(
                title="Export pipeline",
                transient_for=window,
                action=Gtk.FileChooserAction.SAVE,
            )
            dialog.add_buttons(
                "Cancel", Gtk.ResponseType.CANCEL,
                "Save", Gtk.ResponseType.ACCEPT,
            )
            dialog.set_do_overwrite_confirmation(True)
            dialog.set_current_name(suggested_filename or "pipeline.csv")
            accepted = dialog.run() == Gtk.ResponseType.ACCEPT
            filename = dialog.get_filename() if accepted else None
            dialog.destroy()
            if filename:
                download.set_destination(Path(filename).resolve().as_uri())
            else:
                download.cancel()
            return True

        def handle_download(_context, download):
            download.connect("decide-destination", choose_download_destination)

        web_context = view.get_context()
        download_handler = web_context.connect("download-started", handle_download)
        view.load_uri(f"http://127.0.0.1:{server.server_address[1]}")
        window.add(view)

        def show_exit_confirmation(has_unsaved_changes: bool) -> bool:
            message = ("This project has unsaved changes. Exit ASE Studio and discard them?"
                       if has_unsaved_changes else "Exit ASE Studio?")
            dialog = Gtk.MessageDialog(
                transient_for=window,
                modal=True,
                destroy_with_parent=True,
                message_type=Gtk.MessageType.QUESTION,
                buttons=Gtk.ButtonsType.YES_NO,
                text=message,
            )
            dialog.set_title(f"Exit {APPLICATION_NAME}")
            response = dialog.run()
            dialog.destroy()
            return response == Gtk.ResponseType.YES

        def request_window_close(_window, _event) -> bool:
            nonlocal closing
            if closing:
                return True
            dirty = "• Unsaved" in (view.get_title() or "")
            if not show_exit_confirmation(dirty):
                return True
            closing = True
            view.stop_loading()
            # Stop the entire gem5/make process group before stopping HTTP.
            # Both operations run outside GTK's main loop so the window stays
            # responsive while children receive TERM and, if needed, KILL.
            def stop_backend():
                terminate_active_commands()
                server.shutdown()

            threading.Thread(target=stop_backend, daemon=True).start()
            return True

        window.connect("delete-event", request_window_close)
        window.show_all()

        def close_after_server_stops():
            nonlocal window, view, create_handler, ui_destroyed
            if server_thread is not None and server_thread.is_alive():
                return GLib.SOURCE_CONTINUE
            if ui_destroyed:
                return GLib.SOURCE_REMOVE
            ui_destroyed = True
            destroy_memory_window()
            if view is not None:
                if create_handler is not None:
                    view.disconnect(create_handler)
                    create_handler = None
                view.disconnect(policy_handler)
                web_context.disconnect(download_handler)
                view.stop_loading()
                parent = view.get_parent()
                if parent is not None:
                    parent.remove(view)
                view.destroy()
                view = None
            if window is not None:
                doomed_window = window
                window = None
                doomed_window.destroy()

            # Give WebKitGTK one main-loop turn to release native resources
            # before the Gtk.Application and Python interpreter exit.
            def finish_application_shutdown():
                gc.collect()
                app.release()
                app.quit()
                return GLib.SOURCE_REMOVE

            GLib.timeout_add(100, finish_application_shutdown)
            return GLib.SOURCE_REMOVE

        GLib.timeout_add(250, close_after_server_stops)

        if args.smoke_report:
            last_diagnostic = None
            # Modified in the personal fork on 2026-10-28: Monaco renders its view only after opening a project.
            smoke_script = (Path(__file__).parent / 'scripts/native-smoke.js').read_text()
            def finish_smoke(passed):
                nonlocal smoke_passed, smoke_finished, closing
                if smoke_finished:
                    return GLib.SOURCE_REMOVE
                smoke_finished, smoke_passed, closing = True, passed, True
                print('PASS packaged native frontend' if passed else 'Native startup timed out', flush=True)
                threading.Thread(target=server.shutdown, daemon=True).start()
                return GLib.SOURCE_REMOVE

            def received(webview, result, _data):
                nonlocal last_diagnostic
                try:
                    diagnostic = json.loads(webview.evaluate_javascript_finish(result).to_string())
                    if diagnostic != last_diagnostic:
                        print('Native page: ' + json.dumps(diagnostic), flush=True)
                        last_diagnostic = diagnostic
                    if diagnostic['ready']:
                        finish_smoke(True)
                except (GLib.Error, ValueError) as error:
                    diagnostic = str(error)
                    if diagnostic != last_diagnostic:
                        print('Native JavaScript: ' + diagnostic, flush=True)
                        last_diagnostic = diagnostic

            def poll_smoke():
                if smoke_finished or view is None:
                    return GLib.SOURCE_REMOVE
                view.evaluate_javascript(smoke_script, -1, None, None, None, received, None)
                return GLib.SOURCE_CONTINUE

            GLib.timeout_add(250, poll_smoke)
            GLib.timeout_add_seconds(45, lambda: finish_smoke(False))

    application.connect("activate", activate)
    try:
        result = application.run([sys.argv[0]])
    finally:
        terminate_active_commands()
        if server_thread is not None and server_thread.is_alive():
            server.shutdown()
        if server is not None:
            server.server_close()
        if server_thread is not None:
            server_thread.join(timeout=2)
    if args.smoke_report:
        passed = smoke_passed and (server_thread is None or not server_thread.is_alive())
        args.smoke_report.parent.mkdir(parents=True, exist_ok=True)
        args.smoke_report.write_text(json.dumps(dict(status='succeeded' if passed else 'failed',
            started_at=smoke_timestamp, finished_at=datetime.now(timezone.utc).isoformat(timespec='milliseconds'),
            wall_seconds=time.monotonic() - smoke_started,
            backend_stopped=server_thread is None or not server_thread.is_alive()), indent=2) + '\n')
        return 0 if passed and result == 0 else 1
    return result


if __name__ == "__main__":
    raise SystemExit(main())
