import { describe, it } from "vitest";
import { createRuleTester } from "../test-helpers.ts";
import rule from "./no-inline-style-objects.ts";

describe("no-inline-style-objects", () => {
  it("passes RuleTester valid/invalid cases", () => {
    createRuleTester().run("no-inline-style-objects", rule, {
      valid: [
        {
          name: "no style attribute",
          code: '<div className="felt" />;',
          filename: "apps/web/src/App.tsx",
        },
        {
          name: "style bound to a variable, not an inline object literal",
          code: "<div style={dynamicStyle} />;",
          filename: "apps/web/src/App.tsx",
        },
        {
          // RuleTester registers the rule under this synthetic id; in the
          // real repo config the disable comment reads
          // `// eslint-disable-line local/no-inline-style-objects`.
          name: "escape hatch: standard eslint-disable-line comment",
          code: '<div style={{ color: "red" }} />; // eslint-disable-line rule-to-test/no-inline-style-objects',
          filename: "apps/web/src/App.tsx",
        },
      ],
      invalid: [
        {
          name: "inline object literal on a div",
          code: '<div style={{ color: "red" }} />;',
          filename: "apps/web/src/App.tsx",
          errors: [{ messageId: "inlineStyle" }],
        },
        {
          name: "inline object literal on a system component",
          code: "<Button style={{ padding: 4 }}>Click</Button>;",
          filename: "apps/web/src/App.tsx",
          errors: [{ messageId: "inlineStyle" }],
        },
      ],
    });
  });
});
