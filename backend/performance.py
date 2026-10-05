"""Small, content-free performance records. Memory/CPU belong to the process."""
import json
import os
import resource
import sys
import time
from pathlib import Path


def memory():
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    result = {'process_lifetime_peak_rss_bytes': int(peak if sys.platform == 'darwin' else peak * 1024)}
    try:
        result['process_current_rss_bytes'] = int(Path('/proc/self/statm').read_text().split()[1]) * os.sysconf('SC_PAGE_SIZE')
    except (OSError, ValueError, IndexError):
        pass
    return result


def emit(record):
    print(json.dumps({'event': 'retail_performance', **record}, separators=(',', ':')), flush=True)


class Measurement:
    def __init__(self):
        self.started = time.perf_counter()
        self.cpu = time.process_time()
        self.before = memory()
        self.stages = {}

    def call(self, name, function, *args):
        start = time.perf_counter()
        try:
            return function(*args)
        finally:
            self.stages[name + '_seconds'] = round(time.perf_counter() - start, 6)

    def finish(self):
        return {'wall_seconds': round(time.perf_counter() - self.started, 6),
                'process_cpu_seconds': round(time.process_time() - self.cpu, 6),
                'memory_before': self.before, 'memory_after': memory(),
                'stages': self.stages,
                'measurement_scope': 'Server operation only; excludes user thinking and browser rendering. CPU/RSS are shared process metrics; peak RSS is process lifetime, not per-job allocation.'}
