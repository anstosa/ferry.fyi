# private OTA artifact storage
resource "aws_s3_bucket" "ota_artifacts" {
  bucket = local.ota_artifact_bucket_name

  tags = {
    Name = "${local.name_prefix}-ota-artifacts"
  }
}

# retain every published artifact revision
resource "aws_s3_bucket_versioning" "ota_artifacts" {
  bucket = aws_s3_bucket.ota_artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

# encrypt new OTA objects at rest
resource "aws_s3_bucket_server_side_encryption_configuration" "ota_artifacts" {
  bucket = aws_s3_bucket.ota_artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# prevent every public S3 access path
resource "aws_s3_bucket_public_access_block" "ota_artifacts" {
  bucket = aws_s3_bucket.ota_artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# disable ACL-based access controls
resource "aws_s3_bucket_ownership_controls" "ota_artifacts" {
  bucket = aws_s3_bucket.ota_artifacts.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# sign origin requests from this distribution
resource "aws_cloudfront_origin_access_control" "ota" {
  name                              = "${local.name_prefix}-ota"
  description                       = "CloudFront access for private OTA artifacts"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# cache immutable bundles independently from release pointers
resource "aws_cloudfront_cache_policy" "ota_immutable_bundles" {
  name        = "${local.name_prefix}-ota-immutable-bundles"
  comment     = "Cache immutable OTA bundles for one release year"
  default_ttl = var.ota_immutable_bundle_cache_ttl_seconds
  max_ttl     = var.ota_immutable_bundle_cache_ttl_seconds
  min_ttl     = var.ota_immutable_bundle_cache_ttl_seconds

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }

    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
  }
}

# keep channel pointers fresh during staged rollouts
resource "aws_cloudfront_cache_policy" "ota_release_json" {
  name        = "${local.name_prefix}-ota-release-json"
  comment     = "Cache mutable OTA release JSON briefly"
  default_ttl = var.ota_release_cache_ttl_seconds
  max_ttl     = var.ota_release_cache_ttl_seconds
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }

    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
  }
}

# serve private OTA artifacts through HTTPS-only CloudFront
resource "aws_cloudfront_distribution" "ota" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${local.name_prefix} OTA artifact delivery"
  price_class     = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.ota_artifacts.bucket_regional_domain_name
    origin_id                = "ota-artifacts-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.ota.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = aws_cloudfront_cache_policy.ota_release_json.id
    compress               = true
    target_origin_id       = "ota-artifacts-s3"
    viewer_protocol_policy = "redirect-to-https"
  }

  ordered_cache_behavior {
    path_pattern           = "bundles/*"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = aws_cloudfront_cache_policy.ota_immutable_bundles.id
    compress               = true
    target_origin_id       = "ota-artifacts-s3"
    viewer_protocol_policy = "redirect-to-https"
  }

  ordered_cache_behavior {
    path_pattern           = "channels/*.json"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = aws_cloudfront_cache_policy.ota_release_json.id
    compress               = true
    target_origin_id       = "ota-artifacts-s3"
    viewer_protocol_policy = "redirect-to-https"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1.2_2021"
  }
}

# allow reads only when CloudFront signs for this distribution
resource "aws_s3_bucket_policy" "ota_artifacts" {
  bucket = aws_s3_bucket.ota_artifacts.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontDistributionRead"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.ota_artifacts.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.ota.arn
          }
        }
      }
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.ota_artifacts]
}
