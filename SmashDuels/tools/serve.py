#!/usr/bin/env python3
"""Serve the game for the browser, with the cache switched off.

    python3 tools/serve.py            # http://localhost:8080
    python3 tools/serve.py 9000

`python3 -m http.server` is the obvious way to run this and it is also the way to get
lied to: it sends `Last-Modified` and no `Cache-Control`, so a tab is allowed to decide a
script is still fresh, render it from its own cache and never ask the server again.  On a
preview, where the URL never changes and the files change constantly, that means playing a
build from an hour ago and reporting the bug in it as fixed-but-still-broken.  This is the
same handler with `no-store` on every response, plus `no-cache` on the document itself so a
navigation always re-asks for index.html; the `?v=<BUILD>` token in index.html stays as the
belt for any other static host.
"""
import functools
import http.server
import os
import socketserver
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'game')


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # nothing here is worth reusing from cache: the document decides which versioned
        # scripts to ask for, and every script, atlas and item PNG is rebuilt constantly
        self.send_header('Cache-Control', 'no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    os.chdir(ROOT)
    handler = functools.partial(Handler, directory=ROOT)
    with Server(('0.0.0.0', port), handler) as httpd:
        print('serving %s on 0.0.0.0:%d (no-store)' % (os.path.relpath(ROOT), port), flush=True)
        httpd.serve_forever()


if __name__ == '__main__':
    main()
