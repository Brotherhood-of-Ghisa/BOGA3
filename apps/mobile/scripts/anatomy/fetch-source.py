import argparse
import concurrent.futures
import hashlib
import json
import struct
import urllib.request
import zlib
from pathlib import Path

root = Path(__file__).resolve().parent
metadata = json.loads((root / 'source.json').read_text())['sources']
parser = argparse.ArgumentParser(description='Fetch only pinned BodyParts3D source components; no mobile runtime use.')
parser.add_argument('--source-dir', type=Path, default=root.parents[3] / 'apps/mobile/artifacts/muscle-body-anatomy/source')
destination = parser.parse_args().source_dir
destination.mkdir(parents=True, exist_ok=True)
url = metadata['url']

def get_range(value):
    request = urllib.request.Request(url, headers={'Range': 'bytes=' + value})
    with urllib.request.urlopen(request, timeout=45) as response:
        assert response.status == 206, 'Server must honour range requests'
        return response.read()

tail = get_range('-65536')
eocd = struct.unpack_from('<4s4H2LH', tail, tail.rfind(b'PK\x05\x06'))
directory = get_range(f'{eocd[6]}-{eocd[6] + eocd[5] - 1}')
entries = {}
offset = 0
while directory[offset:offset + 4] == b'PK\x01\x02':
    item = struct.unpack_from('<4s6H3L5H2L', directory, offset)
    name = directory[offset + 46:offset + 46 + item[10]].decode()
    entries[Path(name).stem] = item
    offset += 46 + item[10] + item[11] + item[12]

names = {key: record['name'] for key, record in metadata['models'].items()}

def fetch(key):
    entry = entries[key]
    existing = destination / f'{key}.obj'
    if existing.exists():
        data = existing.read_bytes()
        assert len(data) == entry[9] and zlib.crc32(data) == entry[7]
        assert hashlib.sha256(data).hexdigest() == metadata['models'][key]['sha256'], key
        return key, {'name': names[key], 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
    raw = get_range(f'{entry[16]}-{entry[16] + entry[8] + 1024}')
    header = struct.unpack_from('<4s5H3L2H', raw)
    assert header[0] == b'PK\x03\x04'
    start = 30 + header[9] + header[10]
    data = zlib.decompress(raw[start:start + entry[8]], -15)
    assert len(data) == entry[9]
    assert zlib.crc32(data) == entry[7]
    assert hashlib.sha256(data).hexdigest() == metadata['models'][key]['sha256'], key
    (destination / f'{key}.obj').write_bytes(data)
    return key, {'name': names[key], 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
    records = dict(executor.map(fetch, names))

assert records == metadata['models']
print(f'Verified {len(records)} source files in {destination}')
