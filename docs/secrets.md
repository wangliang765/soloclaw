# Secret Management

## Goal

Secrets require a high confidentiality level. The platform must minimize secret exposure, prevent accidental logging, and make secret access explicit, scoped, auditable, and revocable.

## Secret Classes

```text
model_api_key
git_provider_token
ssh_key
environment_secret
deployment_secret
database_credential
webhook_secret
plugin_secret
```

## Storage Strategy

Use a pluggable secret backend.

Local mode:

```text
OS keychain where available
  - macOS Keychain
  - Windows Credential Manager
  - Linux Secret Service / libsecret

encrypted local fallback
  - passphrase-protected
  - file permissions locked down
```

Private production mode:

```text
HashiCorp Vault
Kubernetes Secrets
cloud KMS-backed secret manager
1Password / enterprise vault integration
encrypted PostgreSQL references only
```

The database should store secret references and metadata, not plaintext secret values.

## Current Local MVP

The current local runtime provides an encrypted file fallback:

```text
.agent/secrets.vault.json
```

The vault uses:

```text
AES-256-GCM encryption
scrypt key derivation
AGENT_SECRETS_PASSPHRASE as the local passphrase source
0600 file mode where supported by the OS
short-lived in-process leases
```

CLI:

```text
agent secrets put <name> --class model_api_key --scope-type workspace --scope-id local --value-env ENV_NAME
agent secrets list
agent secrets get <secret-id> --purpose model_api_key --execution-mode full_access
agent secrets get <secret-id> --purpose model_api_key --reveal --execution-mode full_access
agent secrets delete <secret-id>
```

`get` does not print the value unless `--reveal` is explicitly passed. Direct local CLI reads default to `full_access` because they are explicit administrator operations, but `--execution-mode strict|balanced|trusted|full_access` can be used to exercise the same policy behavior used by runtime agents. Prefer `--value-env` or `--value-file` over passing secret values directly in shell history.

Model provider keys can use secret refs:

```text
agent run --provider openai --api-key-secret sec_xxxxxxxx "task"
agent run --provider deepseek --api-key-secret sec_xxxxxxxx "task"
agent run --provider openai_compatible --base-url http://localhost:8000/v1 --api-key-secret sec_xxxxxxxx "task"
agent run --provider anthropic_compatible --base-url http://localhost:8000 --api-key-secret sec_xxxxxxxx "task"
```

Known provider profiles also support environment variables. Defaults include `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` / `GOOGLE_API_KEY`, `MOONSHOT_API_KEY` / `KIMI_API_KEY`, `XAI_API_KEY` / `GROK_API_KEY`, `MINIMAX_API_KEY`, `DEEPSEEK_API_KEY`, `ZAI_API_KEY` / `GLM_API_KEY` / `ZHIPU_API_KEY` / `BIGMODEL_API_KEY`, `DASHSCOPE_API_KEY` / `QWEN_API_KEY`, and `MIMO_API_KEY` / `XIAOMI_MIMO_API_KEY`. `--api-key-env` overrides the default lookup for the selected provider.

Local provider profile overrides can be managed with:

```text
soloclaw
# then run /model setup for the menu-style provider/base URL/model/API key flow
soloclaw model setup --provider openai --api-key-env OPENAI_API_KEY
soloclaw model setup --provider openai_compatible --base-url http://localhost:8000/v1 --model local-model --api-key-env LOCAL_LLM_API_KEY
soloclaw model list --json
soloclaw model use openai_compatible
soloclaw config path
soloclaw config show --json
agent models setup --provider openai --api-key-env OPENAI_API_KEY
agent models setup --provider openai_compatible --base-url http://localhost:8000/v1 --model local-model --api-key-env LOCAL_LLM_API_KEY
agent models profiles list
agent models profiles set openai_compatible --base-url http://localhost:8000/v1 --model local-model --api-key-env LOCAL_LLM_API_KEY --default
agent models profiles remove openai_compatible
```

These overrides are stored in `.agent/model-providers.json` and must not contain raw API keys. The file records only provider metadata, `defaultProvider`, environment variable names, and optional `apiKeySecretRef` identifiers. TUI `/model setup` can accept a pasted API key and store it into `.agent/secrets.vault.json` as an encrypted local secret, then write only the `apiKeySecretRef` into the model profile. Use `--api-key-secret` or an environment variable for the secret value itself. The JSON file is intentionally editable by hand, for example:

```json
{
  "version": 1,
  "defaultProvider": "openai_compatible",
  "profiles": {
    "openai_compatible": {
      "name": "openai_compatible",
      "protocol": "openai_chat",
      "defaultBaseUrl": "http://localhost:8000/v1",
      "defaultModel": "local-model",
      "apiKeyEnvNames": ["LOCAL_LLM_API_KEY"],
      "apiKeySecretRef": "sec_xxxxxxxx"
    }
  }
}
```

`--api-key-secret` resolves through `PolicySecretBroker`, evaluates `secret.read`, mints a short-lived local lease, revokes it after use, and records `secret.accessed` / `secret.denied` audit events without storing raw secret values in audit metadata. This is still a local fallback, not the final high-security backend. Production deployments should use OS keychain, Vault, KMS, or an enterprise secret manager.

## Access Model

Secrets are never directly injected into the model context.

Flow:

```text
tool requests secret reference
  -> policy engine checks actor/session/room/project
  -> approval if required
  -> secret broker mints short-lived access
  -> tool receives secret through protected runtime channel
  -> logs receive redacted placeholder
```

Current local caveat: model provider secret reads are attributed to the local platform caller while the model client is constructed. Production credential routing should bind each read to the concrete session, worker, room, and agent execution identity.

## Redaction

Run redaction at every boundary:

```text
tool input
tool output
command stdout/stderr
model prompt
model response
audit summaries
artifact previews
room messages
plugin outputs
```

Redaction should use:

```text
known secret value matching
token pattern detection
entropy detection
provider-specific key patterns
user-defined regexes
```

Store redaction events for audit:

```text
secret.redacted
secret.accessed
secret.denied
secret.rotated
```

## Least Privilege

Prefer short-lived scoped credentials:

```text
GitHub App installation token
GitLab scoped token
temporary job token
ephemeral SSH key
container-scoped environment variable
```

Workers should not persist long-lived secrets. Control plane or secret broker owns long-lived credentials.

## Room Rules

Rooms can discuss secret access requests, but secret values are never posted into rooms.

High-risk secret access usually requires human approval. Trusted agents may receive super-approval capability only by explicit organization policy.

## Deny by Default

Default denials:

```text
read arbitrary .env
print environment variables
send secrets to model context
write secrets to artifact
share secret in room message
plugin access without declared capability
```

## Implementation Interfaces

```ts
interface SecretStore {
  putSecret(input: PutSecretInput): Promise<SecretRef>;
  getSecret(input: GetSecretInput): Promise<SecretLease>;
  revokeLease(input: RevokeSecretLeaseInput): Promise<void>;
}

interface Redactor {
  registerSecret(ref: SecretRef, valueHint?: string): Promise<void>;
  redact(input: string): Promise<RedactionResult>;
}
```
