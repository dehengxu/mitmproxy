"""
Emulate a slow network connection.

This is the user-facing part of Charles' "Throttle" feature. It provides two
knobs:

* `throttle_bytes_per_sec` limits the transfer rate of response bodies. The
  pacing itself is implemented in the proxy core
  (see `mitmproxy.proxy.layers.http`), this addon only makes sure that bodies
  are streamed in reasonably small chunks so that the limit can be applied
  smoothly.
* `throttle_latency_ms` adds a fixed latency to every request.

Both options are disabled by default and have no effect on the proxy if unset.
"""

import asyncio
from collections.abc import Iterable

from mitmproxy import ctx


class Throttle:
    def load(self, loader):
        loader.add_option(
            "throttle_bytes_per_sec",
            int,
            0,
            """
            Limit the transfer rate to the given number of bytes per second.
            0 (the default) means no limit.

            Note that this turns on response streaming, which means that
            response bodies are no longer stored in the flow unless
            `store_streamed_bodies` is enabled as well.
            """,
        )
        loader.add_option(
            "throttle_latency_ms",
            int,
            0,
            """
            Add the given number of milliseconds of latency to every request.
            0 (the default) means no artificial latency.
            """,
        )

    def chunk_size(self) -> int:
        """
        The size of the chunks that response bodies are split into.

        We aim for ten chunks per second so that the rate limit is applied
        smoothly instead of in big bursts.
        """
        rate = ctx.options.throttle_bytes_per_sec
        if rate <= 0:
            return 0
        return max(1, rate // 10)

    def split(self, data: bytes) -> Iterable[bytes]:
        """Split a message body into chunks that we can throttle individually."""
        size = self.chunk_size()
        if size <= 0 or not data:
            return []
        return [data[i : i + size] for i in range(0, len(data), size)]

    def responseheaders(self, flow):
        if ctx.options.throttle_bytes_per_sec > 0 and flow.response:
            # Streaming is required to apply the rate limit to the body.
            flow.response.stream = self.split

    async def request(self, flow):
        latency = ctx.options.throttle_latency_ms
        if latency > 0:
            await asyncio.sleep(latency / 1000)
