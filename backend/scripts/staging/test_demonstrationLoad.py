"""Offline checks for the additive staging loader. Does not connect to any DB."""
import copy
import json
from pathlib import Path
import subprocess
import unittest

import demonstrationLoad as load


class DemonstrationLoadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        script = Path(__file__).with_name("demonstrationData.js").as_posix()
        cls.plan = json.loads(subprocess.check_output(
            ["node", "-e", "process.stdout.write(JSON.stringify(require(process.argv[1]).buildPlan()))", script],
            text=True, encoding="utf-8"))
        cls.members = [{"id": mid, "global_user_id": load.stable_id("user:" + mid),
                        "display_name": "Existing staging user"} for mid in sorted(load.MEMBERS)]
        cls.sources = [{"opportunity_id": load.stable_id(f"source:{i}"),
                        "revision_id": load.stable_id(f"revision:{i}"), "title": f"Fonte {i}",
                        "snapshot": {"schemaVersion": 2, "contractVersion": "opportunity-v2.0",
                                     "evidence": {"text": "Original d'água \\ source"}}} for i in range(10)]

    def rows(self):
        return load.build_rows(self.plan, self.members, self.sources)

    def test_counts_and_fixed_tenant(self):
        rows = self.rows()
        expected = {"application": 30, "application_task": 90, "application_partner": 30,
                    "application_chat_message": 60, "application_participant": 60,
                    "application_alert": 60, "opportunity_interest": 10, "organization_notice": 6,
                    "organization_notice_recipient": 12}
        for name, count in expected.items():
            self.assertEqual(len(rows["opportunity_catalog." + name]), count)
        for records in rows.values():
            self.assertTrue(all(row["organization_id"] == load.ORG for row in records))
        self.assertEqual(len(rows["organizational_scope.person"]), 12)
        self.assertEqual(len(rows["organizational_scope.scope"]), 6)

    def test_original_source_snapshots_are_preserved(self):
        rows = self.rows()
        for index, row in enumerate(rows["opportunity_catalog.application"]):
            self.assertEqual(row["central_snapshot"], self.sources[index % 10]["snapshot"])
            self.assertEqual(row["central_revision_id"], self.sources[index % 10]["revision_id"])

    def test_revisions_have_coherent_final_states(self):
        rows = self.rows()
        for app in rows["opportunity_catalog.application"]:
            history = [r for r in rows["opportunity_catalog.application_change"] if r["application_id"] == app["application_id"]]
            self.assertEqual([r["revision"] for r in history], list(range(1, app["revision"] + 1)))
            self.assertEqual(history[0]["to_status"], "IDENTIFIED")
            self.assertEqual(history[-1]["to_status"], app["status"])
            for before, after in zip(history, history[1:]):
                self.assertEqual(after["from_status"], before["to_status"])
        for work in rows["opportunity_catalog.application_work"]:
            revisions = [r["revision"] for r in rows["opportunity_catalog.application_work_change"] if r["application_id"] == work["application_id"]]
            self.assertEqual(revisions, list(range(2, work["revision"] + 1)))

    def test_fake_people_do_not_receive_accounts(self):
        rows = self.rows()
        self.assertTrue(all(r["membership_id"] is None for r in rows["organizational_scope.person_profile"]))
        self.assertTrue(all(r["email"].endswith("@example.invalid") for r in rows["organizational_scope.person"]))
        self.assertEqual({r["membership_id"] for r in rows["opportunity_catalog.application_participant"]}, load.MEMBERS)

    def test_sql_is_additive_atomic_and_checks_preservation(self):
        rows = self.rows()
        sql = load.build_sql(rows)
        self.assertTrue(sql.startswith("BEGIN;"))
        self.assertTrue(sql.endswith("COMMIT;\n"))
        self.assertEqual(sql.count("PREVIOUS_ROWS_CHANGED:"), len(rows))
        self.assertEqual(sql.count("COUNT_MISMATCH:"), len(rows))
        for forbidden in ("UPDATE ", "DELETE ", "TRUNCATE ", "ALTER ", "DISABLE ", "ON CONFLICT", "INSERT INTO public."):
            self.assertNotIn(forbidden, sql)
        self.assertIn("SET CONSTRAINTS ALL IMMEDIATE", sql)

    def test_sql_strings_escape_apostrophes_and_preserve_backslashes(self):
        self.assertEqual(load.literal("d'água\\x"), "'d''água\\x'")
        self.assertIn("standard_conforming_strings=on", load.build_sql(self.rows()))
        with self.assertRaises(ValueError):
            load.literal("x\x00")

    def test_rejects_wrong_target_membership_and_batch_ids(self):
        plan = copy.deepcopy(self.plan)
        plan["target"] = "https://production.invalid"
        with self.assertRaises(ValueError):
            load.build_rows(plan, self.members, self.sources)
        with self.assertRaises(ValueError):
            load.build_rows(self.plan, self.members[:1], self.sources)
        plan = copy.deepcopy(self.plan)
        plan["applications"][0]["id"] = load.stable_id("unrelated")
        with self.assertRaises(ValueError):
            load.build_rows(plan, self.members, self.sources)

    def test_repeat_build_is_deterministic_and_does_not_mutate_inputs(self):
        before = copy.deepcopy((self.plan, self.members, self.sources))
        self.assertEqual(load.build_sql(self.rows()), load.build_sql(self.rows()))
        self.assertEqual(before, (self.plan, self.members, self.sources))


if __name__ == "__main__":
    unittest.main()
