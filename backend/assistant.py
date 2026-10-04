"""Bounded structured explanations/suggestions; no action tools or raw file access."""

import asyncio
import json
import os
import time
import urllib.request


async def structured(key, schema, name, evidence, instructions, max_tokens):
    payload = {
        "model": os.environ.get("OPENAI_MODEL", "gpt-4.1-mini"),
        "store": False,
        "max_output_tokens": max_tokens,
        "instructions": instructions,
        "input": json.dumps(evidence),
        "text": {
            "format": {
                "type": "json_schema",
                "name": name,
                "strict": True,
                "schema": schema,
            }
        },
    }

    def call():
        req = urllib.request.Request(
            "https://api.openai.com/v1/responses",
            data=json.dumps(payload).encode(),
            headers={
                "Authorization": "Bearer " + key,
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=35) as response:
            return json.load(response)

    start = time.perf_counter()
    result = await asyncio.to_thread(call)
    text = "".join(
        c.get("text", "")
        for o in result.get("output", [])
        for c in o.get("content", [])
        if c.get("type") == "output_text"
    )
    return json.loads(text), {
        **{
            k: result.get("usage", {}).get(k)
            for k in ("input_tokens", "output_tokens", "total_tokens")
        },
        "latency_ms": round((time.perf_counter() - start) * 1000),
    }
