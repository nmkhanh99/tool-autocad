#!/usr/bin/env python3

import re
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


PLATFORM_ROOT = Path(__file__).resolve().parents[1]
COMMAND_SOURCE = PLATFORM_ROOT / "objectarx/common/CadWebCommands.cpp"
MANIFESTS = (
    PLATFORM_ROOT / "objectarx/macos/PackageContents.xml",
    PLATFORM_ROOT / "objectarx/package/PackageContents.xml",
)


class PackageCommandContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = COMMAND_SOURCE.read_text(encoding="utf-8")
        group_match = re.search(r'kCommandGroup\s*=\s*L"([^"]+)"', source)
        if group_match is None:
            raise AssertionError("Could not find kCommandGroup in CadWebCommands.cpp")
        cls.command_group = group_match.group(1)
        cls.registered_commands = re.findall(
            r'addCommand\s*\(\s*kCommandGroup\s*,\s*L"([A-Z0-9_]+)"'
            r'\s*,\s*L"([A-Z0-9_]+)"',
            source,
            re.DOTALL,
        )
        if not cls.registered_commands:
            raise AssertionError("Could not find registered CadWeb commands")

    def test_manifests_match_registered_commands(self):
        for manifest in MANIFESTS:
            with self.subTest(manifest=manifest):
                root = ET.parse(manifest).getroot()
                entries = root.findall(".//ComponentEntry")
                self.assertTrue(entries, f"No ComponentEntry in {manifest}")
                for entry in entries:
                    commands = entry.find("Commands")
                    self.assertIsNotNone(commands, f"No Commands in {manifest}")
                    self.assertEqual(commands.get("GroupName"), self.command_group)
                    declared = [
                        (command.get("Global"), command.get("Local"))
                        for command in commands.findall("Command")
                    ]
                    self.assertEqual(declared, self.registered_commands)


if __name__ == "__main__":
    unittest.main()
