#!/usr/bin/env python3
"""Validate an image-first deck manifest and its generated slide assets.

Uses only the Python standard library. PNG and JPEG dimensions are supported.
Structural errors always fail. Editorial warnings fail only with --strict.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
from pathlib import Path
from typing import Any


ALLOWED_STATUS = {"planned", "generated", "verified"}
ALLOWED_QA = {"pending", "pass", "fail"}
ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def image_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as handle:
        header = handle.read(24)
        if len(header) >= 24 and header[:8] == b"\x89PNG\r\n\x1a\n":
            width, height = struct.unpack(">II", header[16:24])
            return width, height

        handle.seek(0)
        if handle.read(2) != b"\xff\xd8":
            raise ValueError("unsupported image format; use PNG or JPEG")

        while True:
            marker_start = handle.read(1)
            if not marker_start:
                break
            if marker_start != b"\xff":
                continue
            marker = handle.read(1)
            while marker == b"\xff":
                marker = handle.read(1)
            if not marker or marker in {b"\xd8", b"\xd9"}:
                continue
            length_bytes = handle.read(2)
            if len(length_bytes) != 2:
                break
            segment_length = struct.unpack(">H", length_bytes)[0]
            if segment_length < 2:
                break
            marker_value = marker[0]
            if marker_value in {
                0xC0,
                0xC1,
                0xC2,
                0xC3,
                0xC5,
                0xC6,
                0xC7,
                0xC9,
                0xCA,
                0xCB,
                0xCD,
                0xCE,
                0xCF,
            }:
                data = handle.read(5)
                if len(data) != 5:
                    break
                height, width = struct.unpack(">HH", data[1:5])
                return width, height
            handle.seek(segment_length - 2, 1)

    raise ValueError("could not read image dimensions")


def nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument(
        "--strict",
        action="store_true",
        help="treat editorial warnings as failures",
    )
    args = parser.parse_args()

    errors: list[str] = []
    warnings: list[str] = []
    manifest_path = args.manifest.resolve()

    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"ERROR: manifest not found: {manifest_path}", file=sys.stderr)
        return 2
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: cannot read manifest: {exc}", file=sys.stderr)
        return 2

    if not isinstance(data, dict):
        print("ERROR: manifest root must be an object", file=sys.stderr)
        return 2

    deck = data.get("deck")
    slides = data.get("slides")
    if not isinstance(deck, dict):
        errors.append("deck must be an object")
        deck = {}
    if not isinstance(slides, list) or not slides:
        errors.append("slides must be a non-empty array")
        slides = []

    for field in ("title", "audience", "objective", "language", "style_lock"):
        if not nonempty_string(deck.get(field)):
            errors.append(f"deck.{field} must be a non-empty string")

    width = deck.get("width")
    height = deck.get("height")
    if not isinstance(width, int) or isinstance(width, bool) or width <= 0:
        errors.append("deck.width must be a positive integer")
        width = None
    if not isinstance(height, int) or isinstance(height, bool) or height <= 0:
        errors.append("deck.height must be a positive integer")
        height = None
    if width and height:
        ratio = width / height
        if ratio < 1.2 or ratio > 2.4:
            warnings.append(
                f"deck aspect ratio {width}:{height} is unusual for a landscape presentation"
            )

    ids: set[str] = set()
    images: set[str] = set()
    expected_numbers = list(range(1, len(slides) + 1))

    for index, raw_slide in enumerate(slides, start=1):
        label = f"slide[{index}]"
        if not isinstance(raw_slide, dict):
            errors.append(f"{label} must be an object")
            continue
        slide = raw_slide

        number = slide.get("number")
        if number != index:
            errors.append(
                f"{label}.number must be {index}; got {number!r} (numbers must be contiguous)"
            )

        slide_id = slide.get("id")
        if not nonempty_string(slide_id):
            errors.append(f"{label}.id must be a non-empty string")
        elif not ID_PATTERN.fullmatch(slide_id):
            errors.append(f"{label}.id must use lowercase filename-safe kebab-case")
        elif slide_id in ids:
            errors.append(f"{label}.id duplicates {slide_id!r}")
        else:
            ids.add(slide_id)

        for field in ("role", "message", "visual_brief"):
            if not nonempty_string(slide.get(field)):
                errors.append(f"{label}.{field} must be a non-empty string")

        exact_text = slide.get("exact_text")
        if not isinstance(exact_text, list) or any(
            not nonempty_string(item) for item in exact_text
        ):
            errors.append(f"{label}.exact_text must be an array of non-empty strings")
            exact_text = []
        combined_text = " ".join(exact_text)
        if len(combined_text) > 220:
            warnings.append(
                f"{label}.exact_text is {len(combined_text)} characters; embedded text may be too dense"
            )
        if any(len(item) > 100 for item in exact_text):
            warnings.append(f"{label}.exact_text contains a string over 100 characters")

        source_refs = slide.get("source_refs")
        if not isinstance(source_refs, list) or any(
            not nonempty_string(item) for item in source_refs
        ):
            errors.append(f"{label}.source_refs must be an array of non-empty strings")

        image = slide.get("image")
        image_path: Path | None = None
        if not nonempty_string(image):
            errors.append(f"{label}.image must be a non-empty relative path")
        else:
            path_value = Path(image)
            if path_value.is_absolute() or ".." in path_value.parts:
                errors.append(f"{label}.image must stay relative to the manifest directory")
            elif image in images:
                errors.append(f"{label}.image duplicates {image!r}")
            else:
                images.add(image)
                image_path = manifest_path.parent / path_value

        status = slide.get("status")
        if status not in ALLOWED_STATUS:
            errors.append(f"{label}.status must be one of {sorted(ALLOWED_STATUS)}")

        qa = slide.get("qa")
        if not isinstance(qa, dict):
            errors.append(f"{label}.qa must be an object")
            qa = {}
        for field in ("text", "visual", "source"):
            if qa.get(field) not in ALLOWED_QA:
                errors.append(f"{label}.qa.{field} must be one of {sorted(ALLOWED_QA)}")

        all_qa_pass = all(qa.get(field) == "pass" for field in ("text", "visual", "source"))
        if status == "verified" and not all_qa_pass:
            errors.append(f"{label} is verified but not all QA fields are pass")
        if status != "verified" and all_qa_pass:
            warnings.append(f"{label} has all QA fields passing but status is {status!r}")

        if image_path:
            if image_path.exists():
                try:
                    actual_width, actual_height = image_size(image_path)
                    if width and height and (actual_width, actual_height) != (width, height):
                        errors.append(
                            f"{label}.image is {actual_width}x{actual_height}; expected {width}x{height}"
                        )
                except (OSError, ValueError) as exc:
                    errors.append(f"{label}.image cannot be inspected: {exc}")
            elif status in {"generated", "verified"}:
                errors.append(f"{label}.image does not exist: {image_path}")

    if [slide.get("number") for slide in slides if isinstance(slide, dict)] != expected_numbers:
        # Individual errors above are clearer; this keeps the invariant explicit for malformed gaps.
        pass

    for warning in warnings:
        print(f"WARNING: {warning}")
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)

    if errors:
        print(f"FAILED: {len(errors)} error(s), {len(warnings)} warning(s)", file=sys.stderr)
        return 1
    if args.strict and warnings:
        print(f"FAILED: strict mode rejected {len(warnings)} warning(s)", file=sys.stderr)
        return 1

    print(f"OK: {len(slides)} slide(s), {len(warnings)} warning(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
