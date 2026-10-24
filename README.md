# plateful
🍝 Deciding what's for dinner is the real daily standup.

## Run it
`npm install && npm run seed && npm start`, then open http://localhost:3000 and log in as demo@example.com / demo-password-123.

## Honest disclaimer
This is only a test app and has never been run, so expect a typo or two. Local use only; never deploy it.

## Things that went wrong while building this
- Raw search text in an FTS5 `MATCH` explodes on quotes and operators, so queries are reduced to quoted prefix tokens.
- Drag-and-drop alone locks out keyboard users, so every recipe also gets a day picker and an Add button.

Docs live in `docs/`. Now go eat something.
