# Build the map and publish it to the stack's S3 bucket behind CloudFront.
#   ./infra/deploy-site.ps1 [-Profile hackathon] [-Region ap-south-1] [-Stack whose-smoke] [-WithData]
param(
  [string]$Profile = "hackathon",
  [string]$Region = "ap-south-1",
  [string]$Stack = "whose-smoke",
  [switch]$WithData
)
$ErrorActionPreference = "Stop"
$env:AWS_PROFILE = $Profile
$env:AWS_REGION = $Region
$root = Split-Path -Parent $PSScriptRoot

$out = aws cloudformation describe-stacks --stack-name $Stack --query "Stacks[0].Outputs" --output json | ConvertFrom-Json
$get = { param($k) ($out | Where-Object OutputKey -eq $k).OutputValue }
$bucket = & $get "SiteBucketName"
$dist = & $get "DistributionId"
$keyName = & $get "LocationKeyName"

Push-Location "$root\web"
npm run build
Pop-Location

# hashed assets are immutable; html and runtime config must always revalidate
aws s3 sync "$root\web\dist" "s3://$bucket" --delete --exclude "data/*" --exclude "config.json" --exclude "index.html" `
  --cache-control "public, max-age=31536000, immutable" --only-show-errors
aws s3 cp "$root\web\dist\index.html" "s3://$bucket/index.html" --cache-control "no-cache" --content-type "text/html; charset=utf-8" --only-show-errors

$apiKey = aws location describe-key --key-name $keyName --query Key --output text
$cfg = @{ region = $Region; apiKey = $apiKey; repoUrl = "https://github.com/mahanteshimath/aws_map_it" } | ConvertTo-Json -Compress
$tmp = New-TemporaryFile
[IO.File]::WriteAllText($tmp, $cfg)
aws s3 cp $tmp "s3://$bucket/config.json" --cache-control "no-cache" --content-type "application/json" --only-show-errors
Remove-Item $tmp

if ($WithData) {
  aws s3 sync "$root\web\public\data" "s3://$bucket/data" --cache-control "public, max-age=300" --only-show-errors
}

aws cloudfront create-invalidation --distribution-id $dist --paths "/index.html" "/config.json" "/data/*" --query "Invalidation.Id" --output text
Write-Host ("Live: " + (& $get "SiteUrl"))
