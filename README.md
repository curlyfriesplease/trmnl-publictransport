# trmnl-publictransport
Code for finding bus times for my TRMNL device

## Running locally
`npm run build` (if a disabled script error is hit, use `Set-ExecutionPolicy RemoteSigned -Scope Process`)
then
`node dist/local-runner.js`

## Deploying
`npm prune --production`
`npm run build`
`serverless deploy --stage prod --region eu-west-2`
