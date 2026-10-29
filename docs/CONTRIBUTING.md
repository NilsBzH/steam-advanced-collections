# Development notes

Keep changes focused, preserve dynamic collections and user data, and run the tests, TypeScript check and build described in the [README](../README.md). Do not commit local Steam data, Millennium configuration, logs, credentials or generated archives. Installable archives belong in GitHub Release assets.

## Assisted commit attribution

For new commits made with Codex assistance, keep the maintainer as the Git author and include this plain-text trailer, separated from the message by a blank line:

```text
Co-authored-by: Codex <noreply@openai.com>
```

Git supports adding it explicitly without rewriting previous commits:

```sh
git commit -m "Describe the change" --trailer "Co-authored-by: Codex <noreply@openai.com>"
```

For a multiline message, write the message to a UTF-8 file and use `git commit --file <message-file> --trailer "Co-authored-by: Codex <noreply@openai.com>"`. See the [official Git commit documentation](https://git-scm.com/docs/git-commit).

Project-local Codex instructions can require this trailer for future assisted commits. The maintainer's `AGENTS.md` remains local and ignored. Do not install a blanket Git hook or global commit template that would label unassisted commits as assisted. No existing history is amended or rewritten.
