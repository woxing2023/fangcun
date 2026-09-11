#!/usr/bin/env python3
"""Read a release archive without extraction; emit evidence without matched secrets.

Patterns cannot establish whether arbitrary names are real. Human review of
fixtures, documentation, images and third-party attribution remains necessary.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import struct
import tarfile
import zipfile
import zlib

PATTERNS = {
    'internal_machine_path': re.compile(r'(?<![A-Za-z0-9])/(?:home|data|Users)/[A-Za-z_][A-Za-z0-9_.-]+|[A-Za-z]:[\\/]Users[\\/][A-Za-z_][A-Za-z0-9_.-]+'),
    'private_key_material': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'),
    'credential_token': re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{32,})\b'),
    'student_identifier': re.compile(r'(?:学号|student[_ -]?id)\s*[:：=]\s*[\"\']?\d{6,18}', re.I),
}
FORBIDDEN_PARTS = {'.git', '.gradle', '.idea', '__pycache__', 'node_modules', 'build', 'qa', 'release'}
FORBIDDEN_NAMES = {'AGENTS.md', '.env', 'local.properties', 'signing.properties', '.DS_Store'}
FORBIDDEN_SUFFIX = re.compile(r'\.(?:db|sqlite3?|db-wal|db-shm|sqlite-wal|sqlite-shm|log|apk|aab|jks|keystore|keystore\.id|pem|key|pyc|pyo)$', re.I)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    archive = Path(args.archive)
    findings, members, seen = [], [], set()

    def issue(name, kind, line=None):
        item = {'file': name, 'type': kind}
        if line is not None:
            item['line'] = line
        if item not in findings:
            findings.append(item)

    def scan_text(name, value):
        for kind, pattern in PATTERNS.items():
            for match in pattern.finditer(value):
                # The existing server regression requests an HTTP data URL.
                # Its origin interpolation is not an absolute filesystem path.
                if kind == 'internal_machine_path' and value[:match.start()].endswith('${origin}'):
                    continue
                issue(name, kind, value.count('\n', 0, match.start()) + 1)

    def safe_path(name):
        normalized = name.replace('\\', '/')
        if normalized.startswith('/') or re.match(r'^[A-Za-z]:', normalized) or '..' in PurePosixPath(normalized).parts:
            return False
        return True

    def inspect_png(name, blob):
        if not blob.startswith(b'\x89PNG\r\n\x1a\n'):
            issue(name, 'invalid_png'); return []
        offset, chunks = 8, []
        while offset + 12 <= len(blob):
            size = struct.unpack('>I', blob[offset:offset + 4])[0]
            kind = blob[offset + 4:offset + 8]
            data = blob[offset + 8:offset + 8 + size]
            end = offset + size + 12
            if end > len(blob) or struct.unpack('>I', blob[end - 4:end])[0] != zlib.crc32(kind + data) & 0xffffffff:
                issue(name, 'invalid_png_chunk'); break
            chunks.append(kind.decode('ascii', 'replace'))
            if kind in {b'tEXt', b'zTXt', b'iTXt', b'eXIf', b'tIME'}:
                issue(name, 'png_metadata')
            offset = end
            if kind == b'IEND':
                break
        if offset != len(blob) or not chunks or chunks[-1] != 'IEND':
            issue(name, 'png_trailing_or_missing_data')
        return ['png_chunk_crc', 'png_metadata_scan', 'paper_image_manually_reviewed_separately']

    def inspect_font(name, blob):
        if blob[:4] != b'wOF2':
            issue(name, 'invalid_woff2'); return []
        try:
            from fontTools.ttLib import TTFont
            with TTFont(io.BytesIO(blob)) as font:
                for record in font['name'].names:
                    scan_text(name, record.toUnicode())
            return ['woff2_header', 'font_name_table_scan', 'third_party_license_attribution_preserved']
        except ImportError:
            issue(name, 'font_name_table_requires_manual_review')
        except Exception:
            issue(name, 'font_name_table_unreadable')
        return ['woff2_header']

    def inspect_jar(name, blob):
        try:
            with zipfile.ZipFile(io.BytesIO(blob)) as jar:
                entries = set()
                for entry in jar.infolist():
                    nested = name + '!/' + entry.filename
                    if not safe_path(entry.filename) or entry.filename in entries:
                        issue(name, 'unsafe_jar_member')
                    entries.add(entry.filename)
                    if entry.flag_bits & 1 or (entry.external_attr >> 16) & 0o170000 == 0o120000:
                        issue(name, 'encrypted_or_linked_jar_member')
                    scan_text(nested, entry.filename)
                    if not entry.is_dir():
                        if entry.file_size > 8 * 1024 * 1024:
                            issue(name, 'oversized_jar_member'); continue
                        scan_text(nested, jar.read(entry).decode('utf-8', 'replace'))
        except (zipfile.BadZipFile, RuntimeError):
            issue(name, 'invalid_jar')
        return ['jar_member_paths', 'jar_text_and_bytecode_strings', 'vendor_wrapper_integrity_checked_by_builder']

    raw = archive.read_bytes()
    if len(raw) < 10 or raw[:2] != b'\x1f\x8b':
        issue(archive.name, 'invalid_gzip')
    elif raw[3] & (8 | 16):
        issue(archive.name, 'gzip_original_name_or_comment')
    try:
        with tarfile.open(archive, 'r:gz') as tar:
            for entry in tar:
                name = str(PurePosixPath(entry.name))
                if not safe_path(entry.name):
                    issue(name, 'unsafe_member_path')
                if name in seen:
                    issue(name, 'duplicate_member')
                seen.add(name)
                if entry.uid != 0 or entry.gid != 0 or entry.uname not in ('', 'root') or entry.gname not in ('', 'root'):
                    issue(name, 'archive_owner_metadata')
                if entry.pax_headers:
                    issue(name, 'extended_archive_metadata')
                parts = PurePosixPath(name).parts
                if set(parts) & FORBIDDEN_PARTS or PurePosixPath(name).name in FORBIDDEN_NAMES or FORBIDDEN_SUFFIX.search(name):
                    issue(name, 'forbidden_member')
                if entry.issym() or entry.islnk() or not (entry.isdir() or entry.isfile()):
                    issue(name, 'unsupported_member_type')
                row = {'path': name, 'size': entry.size, 'sha256': None, 'kind': 'directory', 'checks': ['path', 'owner_metadata', 'member_type', 'denylist']}
                if entry.isfile():
                    if entry.size > 32 * 1024 * 1024:
                        issue(name, 'oversized_member'); members.append(row); continue
                    blob = tar.extractfile(entry).read()
                    row['sha256'] = hashlib.sha256(blob).hexdigest()
                    suffix = PurePosixPath(name).suffix.lower()
                    if suffix == '.png':
                        row['kind'] = 'png'; row['checks'] += inspect_png(name, blob)
                        if name != 'xuan-fibers-mobile.png':
                            issue(name, 'unexpected_raster_image')
                    elif suffix == '.woff2':
                        row['kind'] = 'font'; row['checks'] += inspect_font(name, blob)
                    elif suffix == '.jar':
                        row['kind'] = 'vendor_jar'; row['checks'] += inspect_jar(name, blob)
                        if name != 'android/gradle/wrapper/gradle-wrapper.jar':
                            issue(name, 'unexpected_jar')
                    else:
                        row['kind'] = 'text'
                        try:
                            scan_text(name, blob.decode('utf-8-sig'))
                            if b'\0' in blob:
                                issue(name, 'unexpected_binary')
                        except UnicodeDecodeError:
                            issue(name, 'unreviewed_binary')
                        row['checks'] += list(PATTERNS)
                members.append(row)
    except (tarfile.TarError, EOFError):
        issue(archive.name, 'invalid_tar')
    report = {
        'passed': not findings,
        'archive': archive.name,
        'archiveSHA256': hashlib.sha256(raw).hexdigest(),
        'memberCount': len(members),
        'fileCount': sum(m['kind'] != 'directory' for m in members),
        'findings': findings,
        'members': members,
        'reviewScope': 'Archive members, owner metadata, text patterns, PNG chunks, font names and vendor JAR strings; no extraction or external access.',
        'manualReviewRequired': 'Arbitrary real names and student/course data require human review of text, fixtures and images; third-party license attribution is retained. Automated pattern checks alone do not certify their absence.',
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'passed': report['passed'], 'members': len(members), 'files': report['fileCount'], 'findings': len(findings), 'report': output.name}))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
