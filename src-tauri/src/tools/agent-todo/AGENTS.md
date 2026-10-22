# Native Agent TODO

- Read agent folders only. The one write outside the app data folder is the instruction line in `instructions.rs`, made only when the user clicks Add or Remove; back up first and keep every other byte.
- Keep `instructions::LINE` in step with `RULE_LINE` in `src/tools/agent-todo/types.ts`, and the snapshot and item fields in step with `types.ts`.
- Read only what a file added since its cursor; never read a whole old chat. Format notes and fixtures: `src/tools/agent-todo/README.md` and `fixtures/`.
- Send badges only through `PetHub` in `platform/pet_events.rs`; never check whether a pet exists. Grant commands in `capabilities/agent-todo.json`, main window only.
