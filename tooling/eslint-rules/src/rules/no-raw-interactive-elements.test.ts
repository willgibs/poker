import { describe, it } from "vitest";
import { createRuleTester } from "../test-helpers.ts";
import rule from "./no-raw-interactive-elements.ts";

describe("no-raw-interactive-elements", () => {
  it("passes RuleTester valid/invalid cases", () => {
    createRuleTester().run("no-raw-interactive-elements", rule, {
      valid: [
        {
          name: "custom system component, uppercase tag",
          code: "<Button onPress={onClick}>Click</Button>;",
          filename: "apps/web/src/App.tsx",
        },
        {
          name: "raw button allowed inside packages/ui itself",
          code: "<button>Click</button>;",
          filename: "packages/ui/src/Button.tsx",
        },
        {
          // TS forbids JSX syntax in a plain .ts file, so the realistic case
          // for the ".tsx only" gate is a .jsx file (JSX with no TS parser
          // restriction on the extension) — this rule doesn't reach it yet.
          name: "not a .tsx file — rule has nothing to flag yet",
          code: "<button>Click</button>;",
          filename: "packages/bots/src/x.jsx",
        },
      ],
      invalid: [
        {
          name: "raw button outside packages/ui",
          code: "<button onClick={fn}>Click</button>;",
          filename: "apps/web/src/App.tsx",
          errors: [{ messageId: "rawInteractiveElement", data: { tag: "button" } }],
        },
        {
          name: "raw anchor outside packages/ui",
          code: '<a href="/x">Link</a>;',
          filename: "packages/bots/src/Foo.tsx",
          errors: [{ messageId: "rawInteractiveElement", data: { tag: "a" } }],
        },
      ],
    });
  });
});
