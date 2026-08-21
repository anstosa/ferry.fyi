#!/usr/bin/env python3
"""Assert the production-like Android package contracts."""

from __future__ import annotations

import argparse
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ANDROID_NAMESPACE = "http://schemas.android.com/apk/res/android"
ANDROID_ATTRIBUTE = f"{{{ANDROID_NAMESPACE}}}"
GOOGLE_ADVERTISING_ID_PERMISSION = "com.google.android.gms.permission.AD_ID"


# stop on a violated build contract
def require(condition: bool, message: str) -> None:
    # surface one actionable failure
    if not condition:
        raise AssertionError(message)


# read one android namespaced attribute
def android_attribute(element: ET.Element, name: str) -> str | None:
    return element.get(f"{ANDROID_ATTRIBUTE}{name}")


# parse one xml document
def parse_xml(path: Path) -> ET.Element:
    require(path.is_file(), f"missing XML file: {path}")
    return ET.parse(path).getroot()


# resolve one manifest xml resource
def resolve_xml_resource(reference: str, resource_root: Path) -> Path:
    match = re.fullmatch(r"@xml/([A-Za-z0-9_.-]+)", reference)
    require(match is not None, f"expected an @xml resource reference, got: {reference}")
    return resource_root / f"{match.group(1)}.xml"


# require explicit backup exclusions
def verify_backup_contract(source_manifest: Path, resource_root: Path) -> None:
    manifest = parse_xml(source_manifest)
    application = manifest.find("application")
    require(application is not None, "source manifest has no application element")
    allow_backup = android_attribute(application, "allowBackup")
    require(allow_backup in {"true", "false"}, "android:allowBackup must be explicit")

    # allow a complete backup opt-out
    if allow_backup == "false":
        return

    backup_references = {
        "fullBackupContent": "full-backup-content",
        "dataExtractionRules": "data-extraction-rules",
    }
    # check both legacy and current backup rules
    for attribute_name, expected_root in backup_references.items():
        reference = android_attribute(application, attribute_name)
        require(
            reference is not None,
            f"android:{attribute_name} must be explicit when backup is enabled",
        )
        resource_path = resolve_xml_resource(reference, resource_root)
        resource = parse_xml(resource_path)
        require(
            resource.tag == expected_root, f"{resource_path} must use <{expected_root}>"
        )
        excludes = resource.findall(".//exclude")
        require(excludes, f"{resource_path} must declare explicit backup exclusions")
        # find the secure runtime exclusion
        require(
            any(
                (exclude.get("path") or "").startswith("leaderboard-automatic")
                # continue the bounded operation
                for exclude in excludes
            ),
            f"{resource_path} must exclude automatic leaderboard runtime data",
        )

        # cover both android 12 backup channels
        if attribute_name == "dataExtractionRules":
            # continue the bounded operation
            for channel in ("cloud-backup", "device-transfer"):
                channel_element = resource.find(channel)
                require(
                    channel_element is not None,
                    f"{resource_path} must declare <{channel}>",
                )
                require(
                    channel_element.findall("exclude"),
                    f"{resource_path} must exclude data from <{channel}>",
                )


# assert one final android manifest
def verify_built_manifest(built_manifest: Path, capability_enabled: bool) -> None:
    manifest = parse_xml(built_manifest)
    require(
        manifest.get("package") == "fyi.ferry",
        "Android package id must remain fyi.ferry",
    )
    uses_sdk = manifest.find("uses-sdk")
    require(uses_sdk is not None, "built manifest has no uses-sdk element")
    require(
        android_attribute(uses_sdk, "minSdkVersion") == "26",
        "Android minSdk must remain API 26",
    )
    require(
        android_attribute(uses_sdk, "targetSdkVersion") == "36",
        "Android targetSdk must remain API 36",
    )

    # inspect every merged permission
    permissions = {
        android_attribute(permission, "name")
        # continue the bounded operation
        for permission in manifest.findall("uses-permission")
    }
    has_background_location = (
        "android.permission.ACCESS_BACKGROUND_LOCATION" in permissions
    )
    require(
        has_background_location == capability_enabled,
        "background location must exist only in the N1 capability build",
    )
    require(
        "android.permission.FOREGROUND_SERVICE_LOCATION" not in permissions,
        "native builds must not request a location foreground service",
    )
    require(
        GOOGLE_ADVERTISING_ID_PERMISSION not in permissions,
        "first-party contextual ads must not request the Google advertising ID",
    )

    application = manifest.find("application")
    require(application is not None, "built manifest has no application element")
    expected_receivers = {
        "fyi.ferry.leaderboards.AutomaticGeofenceReceiverV1",
        "fyi.ferry.leaderboards.AutomaticBootReceiverV1",
    }
    receiver_names: set[str] = set()
    expected_enabled = "false"
    # require clean-install receiver boundaries for every build
    for receiver in application.findall("receiver"):
        receiver_name = android_attribute(receiver, "name") or ""
        # inspect the two automatic runtime receivers
        if receiver_name in expected_receivers:
            receiver_names.add(receiver_name)
            require(
                android_attribute(receiver, "enabled") == expected_enabled,
                f"receiver enabled state does not match the selected capability build: {receiver_name}",
            )
            require(
                android_attribute(receiver, "exported") == "false",
                f"receiver must not be exported: {receiver_name}",
            )
    require(
        receiver_names == expected_receivers,
        "built manifest is missing the automatic runtime receivers",
    )

    # reject every merged location foreground service
    for service in application.findall("service"):
        service_name = android_attribute(service, "name") or "<unnamed>"
        # normalize merged service types
        service_types = {
            service_type.strip()
            # continue the bounded operation
            for service_type in (
                android_attribute(service, "foregroundServiceType") or ""
            ).split("|")
        }
        require(
            "location" not in service_types,
            f"location foreground service is not approved: {service_name}",
        )


# parse command-line paths
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--built-manifest", type=Path, required=True)
    parser.add_argument("--source-manifest", type=Path, required=True)
    parser.add_argument("--resource-root", type=Path, required=True)
    parser.add_argument("--variant", choices=("debug", "n1-capability"), required=True)
    return parser.parse_args()


# run all android assertions
def main() -> int:
    args = parse_args()
    capability_enabled = args.variant == "n1-capability"
    verify_built_manifest(args.built_manifest, capability_enabled)
    verify_backup_contract(args.source_manifest, args.resource_root)
    print(
        f"Android {args.variant} manifest, backup, location-service, and API-floor contracts passed"
    )
    return 0


# expose script failures to ci
if __name__ == "__main__":
    # attempt the protected operation
    try:
        sys.exit(main())
    # keep assertion output concise
    except (AssertionError, ET.ParseError) as error:
        print(f"Android native build contract failed: {error}", file=sys.stderr)
        sys.exit(1)
