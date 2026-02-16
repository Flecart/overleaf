# GitHub Actions Workflows for Docker Image Building

This directory contains workflows for automatically building and pushing Docker images to GitHub Container Registry (ghcr.io).

## Workflow Structure

### Template Workflow
- **`build-push-template.yml`** - Reusable template that handles the actual build and push logic
  - Uses `docker compose build` from the `develop` directory
  - Tags and pushes images to `ghcr.io/flecart/overleaf-<service>:ai-tutor`

### Service-Specific Workflows
Each service has its own workflow that triggers on changes to that service's code:

- `build-web.yml` - Triggers on changes to `services/web/**`
- `build-chat.yml` - Triggers on changes to `services/chat/**`
- `build-clsi.yml` - Triggers on changes to `services/clsi/**`
- `build-document-updater.yml` - Triggers on changes to `services/document-updater/**`
- ... and more

All service workflows also trigger on changes to `libraries/**` since shared libraries affect all services.

### Build All Services
- **`build-all-services.yml`** - Builds all services in parallel
  - Triggers manually via workflow_dispatch
  - Also triggers on changes to shared libraries or the template workflow itself

## How It Works

1. **Automatic Builds**: When you push changes to a service (e.g., `services/web/`), the corresponding workflow automatically:
   - Checks out the code
   - Builds the service using `docker compose build <service>`
   - Tags the image as `ghcr.io/flecart/overleaf-<service>:ai-tutor`
   - Pushes to GitHub Container Registry

2. **Manual Builds**: You can manually trigger any workflow from the GitHub Actions tab:
   - Go to Actions → Select workflow → Click "Run workflow"

3. **Library Changes**: Changes to shared libraries trigger a full rebuild of all services

## Manual Push (First Time Setup)

Before the workflows can push to ghcr.io, you need to authenticate locally and push at least once:

```bash
# 1. Authenticate with GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Or use a Personal Access Token
docker login ghcr.io -u USERNAME

# 2. Build the image (if not already built)
cd /path/to/overleaf/develop
docker compose build web

# 3. Tag and push
docker tag develop_web ghcr.io/flecart/overleaf-web:ai-tutor
docker push ghcr.io/flecart/overleaf-web:ai-tutor
```

## Workflow Permissions

The workflows use `GITHUB_TOKEN` which is automatically provided by GitHub Actions. This token has permissions to:
- Read repository contents
- Write to GitHub Packages (ghcr.io)

No additional secrets are required.

## Adding a New Service Workflow

To add a workflow for a new service:

1. Copy an existing service workflow (e.g., `build-web.yml`)
2. Update the name and paths:
   ```yaml
   name: Build and Push <Service> Service

   on:
     push:
       branches:
         - main
       paths:
         - 'services/<service>/**'
         - 'libraries/**'

   jobs:
     build-<service>:
       uses: ./.github/workflows/build-push-template.yml
       with:
         service: <service>
         image_tag: ai-tutor
       secrets: inherit
   ```

## Deployment

Once images are pushed to ghcr.io, update your terraform deployment:

```hcl
# terraform.tfvars
use_prebuilt_images  = true
docker_image_prefix  = "ghcr.io/flecart/overleaf"
docker_image_tag     = "ai-tutor"
```

Then deploy:
```bash
terraform apply
```

## Pulling Images on Remote Server

To pull and restart with the new images:

```bash
ssh -i overleaf-key.pem ubuntu@<ip>

# Pull latest images
cd /opt/overleaf/develop
docker compose pull

# Restart services
docker compose up -d

# Or restart a specific service
docker compose up -d web
```
