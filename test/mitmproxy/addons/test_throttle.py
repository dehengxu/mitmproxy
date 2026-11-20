import asyncio
import time

from .test_clientplayback import tcp_server
from mitmproxy.addons import throttle
from mitmproxy.addons.next_layer import NextLayer
from mitmproxy.addons.proxyserver import Proxyserver
from mitmproxy.test import taddons
from mitmproxy.test import tflow


class TestThrottle:
    def test_defaults(self):
        with taddons.context(throttle.Throttle()) as tctx:
            assert tctx.options.throttle_bytes_per_sec == 0
            assert tctx.options.throttle_latency_ms == 0

    def test_chunk_size(self):
        th = throttle.Throttle()
        with taddons.context(th) as tctx:
            assert th.chunk_size() == 0
            tctx.configure(th, throttle_bytes_per_sec=1000)
            assert th.chunk_size() == 100
            tctx.configure(th, throttle_bytes_per_sec=5)
            assert th.chunk_size() == 1

    def test_split(self):
        th = throttle.Throttle()
        with taddons.context(th) as tctx:
            assert list(th.split(b"")) == []
            tctx.configure(th, throttle_bytes_per_sec=100)
            # chunk size is rate / 10
            assert list(th.split(b"0123456789abcdefghij")) == [
                b"0123456789",
                b"abcdefghij",
            ]

    def test_response_stream(self):
        th = throttle.Throttle()
        with taddons.context(th) as tctx:
            f = tflow.tflow(resp=True)
            th.responseheaders(f)
            assert f.response.stream is False

            tctx.configure(th, throttle_bytes_per_sec=100)
            th.responseheaders(f)
            assert callable(f.response.stream)

    async def test_latency(self):
        th = throttle.Throttle()
        with taddons.context(th) as tctx:
            tctx.configure(th, throttle_latency_ms=100)
            f = tflow.tflow()
            start = time.monotonic()
            await th.request(f)
            assert time.monotonic() - start >= 0.09


async def test_end_to_end():
    """The response body must be transferred at the configured rate."""
    body = b"x" * 500

    async def server_handler(reader, writer):
        await reader.readuntil(b"\r\n\r\n")
        writer.write(
            b"HTTP/1.1 200 OK\r\nContent-Length: %d\r\n\r\n" % len(body) + body
        )
        await writer.drain()

    ps = Proxyserver()
    nl = NextLayer()
    th = throttle.Throttle()

    with taddons.context(ps, nl, th) as tctx:
        async with tcp_server(server_handler) as addr:
            tctx.configure(ps, listen_host="127.0.0.1", listen_port=0)
            assert await ps.setup_servers()
            ps.running()
            proxy_addr = ps.listen_addrs()[0]

            # 1000 bytes/sec -> 500 bytes take at least 0.5 seconds.
            tctx.configure(th, throttle_bytes_per_sec=1000)

            reader, writer = await asyncio.open_connection(*proxy_addr)
            writer.write(
                f"GET http://{addr[0]}:{addr[1]}/hello HTTP/1.1\r\n\r\n".encode()
            )
            start = time.monotonic()
            assert b"200 OK" in await reader.readuntil(b"\r\n\r\n")
            assert await reader.readexactly(len(body)) == body
            elapsed = time.monotonic() - start
            assert elapsed >= 0.4, f"body was transferred too quickly ({elapsed:.2f}s)"

            writer.close()
            await writer.wait_closed()
