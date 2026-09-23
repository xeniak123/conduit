# Conduit

**Every model, one desktop app.** Chat with any provider, download and run
models on your own GPU, talk to your computer, let it work on screen, schedule
tasks, plug coding agents into any model, and serve all of it to your other
apps through one local API.

Free and open source (MIT). Bring your own keys, or run everything locally.
No account needed.

[Website](https://xeniak123.github.io/conduit) ·
[Download](https://github.com/xeniak123/conduit/releases/latest) ·
[Registry](registry/)

---

## One app instead of ten

| You would otherwise use | In Conduit |
| --- | --- |
| ChatGPT, Claude | Chat with memory, projects, file and image attachments, tables, maths (LaTeX), live HTML previews, branching, pinned and renamed chats, and a meter for how much of the conversation the model sees. Import your old chats from ChatGPT and Claude exports. |
| Cline, Cursor's agent | **Code mode**: the agent reads, searches, edits and runs your tests. **Plan** first and nothing changes until you say go; every edit is approved as a diff; every reply that changed files can be reviewed and undone in one click. |
| Colab notebooks for fine-tuning | **Fine-tune**: training data from Hugging Face, a file or your own chats; LoRA, QLoRA or full; a memory check against your GPU; a plain script you can read. |
| OpenRouter and every provider's console | One switcher with every model your keys unlock: Anthropic, OpenAI, Gemini, OpenRouter, Hugging Face, Groq, DeepSeek, Mistral, xAI and more. |
| LM Studio, Ollama | **Model hub**: search Hugging Face, pick a quantization, see whether it fits your GPU before downloading, load it with one click. |
| Unsloth start, manual env vars | **Agents**: open Claude Code, Codex, OpenCode, Aider or Goose on any model in Conduit, including a local one, without touching their config. |
| Wispr Flow, dictation apps | Hold a key and talk into any app. Whisper can run on your own machine. |
| Computer-use agents | **Screen**: it looks, clicks and types, with a marker wherever it acts. Esc stops it. |
| Cron jobs and reminders | **Scheduled**: prompts that run on their own every day, weekday or week. |
| An API gateway | An OpenAI-, Anthropic- and Responses-compatible endpoint on localhost for every model. |
| Plugin stores | **Store**: MCP servers (GitHub, Notion, Supabase…), skills and desktop pets from an open registry. |

## The message box

Everything a chat can do is switched right where you type:

- **+** to upload files, add photos, attach a screenshot, or use a saved prompt
- **Approval level**: Ask me first, Ask for risky, or Approve for me
- **Search**, **Code** and **Screen** switches

## Safety

- Keys live in the operating system's credential store. The interface can store
  a key and ask whether one exists, never read it back. Keys are attached to a
  request natively, as it leaves the app.
- Approvals show the exact command, not a summary of it.
- Screen control never enters passwords or card details and never confirms a
  purchase. It stops on login and payment screens.
- Every tool call can be written to an audit log, with secrets redacted.
- Extensions and pets never run downloaded code inside the app.
- The optional account syncs prompts, memories and settings. Never keys.
- Signing in happens in your browser, not in the app: Conduit has no password
  field, and only a one-time code comes back to it.
- Another program can be granted access with one approval instead of a pasted
  key. What it gets is a revokable token, never your provider keys. See
  [Connect your app](https://xeniak123.github.io/conduit/oauth.html).

## Running it

```bash
npm install
npm run app          # development
npm run app:build    # installer in src-tauri/target/release/bundle
npm run check        # types and tests
```

Always start development with `npm run app`: the interface is served by Vite,
and the bare executable has nothing to connect to.

## Releasing

Push a tag such as `v0.3.0`. The Release workflow builds the Windows
installer, signs the update bundle with the key in the
`TAURI_SIGNING_PRIVATE_KEY` repository secret, and publishes `latest.json`,
which installed copies check every few hours.

## Layout

```
src/            React interface, agent loop, providers, model hub, scheduler
src-tauri/      Rust: keychain, proxy, screen, audio, local API, processes
registry/       The public store: MCP servers, skills, pets
site/           The website, deployed to GitHub Pages
```

## License

MIT
