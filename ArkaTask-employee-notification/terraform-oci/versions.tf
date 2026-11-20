terraform {
  required_version = ">= 1.12.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 7.0"
    }
  }

  # bucket, namespace, region, and API-key auth come from -backend-config.
  # The bucket is created once by hand. See backend.hcl.example and README.md.
  backend "oci" {
    key = "employee-notification/terraform.tfstate"
  }
}
