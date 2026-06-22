# Build and Publish

## Build local Docker image

```powershell
cd "C:\Users\stanislav.shchukin\Documents\Codex\2026-06-18\hej-co-masz-za-przegl-darke\outputs\codex-n8n-bridge"
docker build -t codex-n8n-bridge:local .
```

## Run local image

```powershell
docker run --rm -p 8788:8787 `
  -e CODEX_BRIDGE_TOKEN=codex-test-token `
  -e CODEX_BRIDGE_CWD=/workspace `
  -e CODEX_BRIDGE_DISABLE_MCP=1 `
  -v "${PWD}\..\..:/workspace" `
  -v codex-test-home:/root/.codex `
  codex-n8n-bridge:local
```

## Publish to GitHub

Create a new GitHub repo, then from this folder:

```powershell
git init
git add .
git commit -m "Initial Codex n8n bridge"
git branch -M main
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

## Push image to GitHub Container Registry

```powershell
docker login ghcr.io
docker tag codex-n8n-bridge:local ghcr.io/<owner>/codex-n8n-bridge:latest
docker push ghcr.io/<owner>/codex-n8n-bridge:latest
```

Then use this image in compose:

```yaml
image: ghcr.io/<owner>/codex-n8n-bridge:latest
```
