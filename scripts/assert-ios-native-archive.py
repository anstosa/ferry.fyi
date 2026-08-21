#!/usr/bin/env python3
"""Assert the archived iOS privacy and background-mode contract."""

from __future__ import annotations

import argparse
import plistlib
import sys
from pathlib import Path
from typing import Any

SYSTEM_BOOT_TIME_CATEGORY = "NSPrivacyAccessedAPICategorySystemBootTime"
SYSTEM_BOOT_TIME_TIMESTAMP_REASON = "8FFB.1"


# stop on a violated archive contract
def require(condition: bool, message: str) -> None:
    # surface one actionable failure
    if not condition:
        raise AssertionError(message)


# read one archived plist
def read_plist(path: Path) -> dict[str, Any]:
    require(path.is_file(), f"missing archived plist: {path}")
    # scope the protected read
    with path.open("rb") as plist_file:
        value = plistlib.load(plist_file)
    require(
        isinstance(value, dict), f"archived plist must contain a dictionary: {path}"
    )
    return value


# verify the required-reason declaration
def verify_privacy_manifest(privacy_manifest: Path) -> None:
    privacy = read_plist(privacy_manifest)
    require(
        privacy.get("NSPrivacyTracking") is False,
        "PrivacyInfo.xcprivacy must declare tracking disabled",
    )
    accessed_types = privacy.get("NSPrivacyAccessedAPITypes")
    require(
        isinstance(accessed_types, list),
        "PrivacyInfo.xcprivacy must list accessed API types",
    )
    boot_time_reasons: list[str] | None = None
    # find the system boot time declaration
    for accessed_type in accessed_types:
        # ignore malformed unrelated entries here
        if not isinstance(accessed_type, dict):
            continue
        # capture the matching approved-reason list
        if accessed_type.get("NSPrivacyAccessedAPIType") == SYSTEM_BOOT_TIME_CATEGORY:
            reasons = accessed_type.get("NSPrivacyAccessedAPITypeReasons")
            require(
                isinstance(reasons, list), "system boot time reasons must be an array"
            )
            # validate every declared reason type
            require(
                all(isinstance(reason, str) for reason in reasons),
                "system boot time reasons must be strings",
            )
            boot_time_reasons = reasons
            break

    require(
        boot_time_reasons is not None,
        "archive must declare the system boot time API category",
    )
    require(
        boot_time_reasons, "system boot time API category must have an approved reason"
    )
    require(
        boot_time_reasons == [SYSTEM_BOOT_TIME_TIMESTAMP_REASON],
        "ProcessInfo.systemUptime absolute timestamp use must declare only reason 8FFB.1",
    )


# verify the built app plist
def verify_app_plist(app_plist: Path) -> None:
    app = read_plist(app_plist)
    require(
        app.get("CFBundleIdentifier") == "fyi.ferry",
        "archived bundle id must remain fyi.ferry",
    )
    require(
        app.get("MinimumOSVersion") == "15.0",
        "archived iOS deployment floor must remain 15.0",
    )
    require(
        app.get("AutomaticLeaderboardCheckinsEnabled") is False,
        "Release archive must keep automatic leaderboard check-ins disabled",
    )
    require(
        "NSUserTrackingUsageDescription" not in app,
        "Release archive must not request App Tracking Transparency authorization",
    )
    background_modes = app.get("UIBackgroundModes", [])
    require(
        isinstance(background_modes, list),
        "UIBackgroundModes must be an array when present",
    )
    # validate every built background mode
    require(
        all(isinstance(mode, str) for mode in background_modes),
        "UIBackgroundModes values must be strings",
    )
    require(
        "location" not in background_modes,
        "archived app must not enable unapproved background location mode",
    )


# parse the archive location
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, required=True)
    return parser.parse_args()


# run all ios assertions
def main() -> int:
    args = parse_args()
    app_root = args.archive / "Products" / "Applications" / "Ferry FYI.app"
    require(app_root.is_dir(), f"missing archived app bundle: {app_root}")
    verify_privacy_manifest(app_root / "PrivacyInfo.xcprivacy")
    verify_app_plist(app_root / "Info.plist")
    print("iOS archive privacy manifest and background-mode contracts passed")
    return 0


# expose script failures to ci
if __name__ == "__main__":
    # attempt the protected operation
    try:
        sys.exit(main())
    # keep assertion output concise
    except (AssertionError, plistlib.InvalidFileException) as error:
        print(f"iOS native archive contract failed: {error}", file=sys.stderr)
        sys.exit(1)
