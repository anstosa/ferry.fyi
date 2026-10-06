#!/usr/bin/env python3
"""Compare OTA payloads without trusting ZIP timestamps or entry ordering."""

import hashlib
import sys
import zipfile


# hash every archive member without extracting files
def payload_hashes(filename: str) -> dict[str, str]:
    # close each archive after verifying all member contents
    with zipfile.ZipFile(filename) as archive:
        entries = archive.infolist()
        # reject ambiguous duplicate paths instead of selecting one payload
        if len({entry.filename for entry in entries}) != len(entries):
            raise ValueError("OTA bundle contains duplicate archive paths")
        hashes = {}
        # retain exact paths while ignoring archive metadata
        for entry in entries:
            checksum = hashlib.sha256()
            # stream contents and let the ZIP reader verify their CRC
            with archive.open(entry) as contents:
                # bound memory use for large assets
                while chunk := contents.read(1024 * 1024):
                    checksum.update(chunk)
            hashes[entry.filename] = checksum.hexdigest()
        return hashes


# fail publication visibly if configuration or payload changed under one version
def main() -> None:
    # require both immutable ZIPs before comparing their payloads
    if len(sys.argv) != 3:
        raise ValueError("Expected previous and candidate OTA ZIP paths")
    # permit metadata-only retries, never different app assets
    if payload_hashes(sys.argv[1]) != payload_hashes(sys.argv[2]):
        raise ValueError("OTA payload changed; publish a new source revision/version")


# keep the comparison usable independently from the publisher
if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
