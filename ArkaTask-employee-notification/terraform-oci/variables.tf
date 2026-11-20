variable "tenancy_ocid" {
  type        = string
  description = "Tenancy OCID. Set with TF_VAR_tenancy_ocid. Do not commit it."

  validation {
    condition     = can(regex("^ocid1\\.tenancy\\.", var.tenancy_ocid))
    error_message = "tenancy_ocid must be a tenancy OCID."
  }
}

variable "user_ocid" {
  type        = string
  description = "API user OCID."

  validation {
    condition     = can(regex("^ocid1\\.user\\.", var.user_ocid))
    error_message = "user_ocid must be a user OCID."
  }
}

variable "fingerprint" {
  type        = string
  description = "Fingerprint of the API signing key uploaded to the user."

  validation {
    condition     = length(var.fingerprint) > 0
    error_message = "fingerprint must be set."
  }
}

variable "private_key" {
  type        = string
  sensitive   = true
  description = "PEM contents of the API signing private key. Sensitive. Never commit it."

  validation {
    condition     = length(var.private_key) > 0 && can(regex("PRIVATE KEY", var.private_key))
    error_message = "private_key must be the PEM text of the API signing key."
  }
}

variable "region" {
  type        = string
  description = "Home region identifier, for example eu-frankfurt-1. Always Free Ampere is only in the home region."

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]+$", var.region))
    error_message = "region must look like eu-frankfurt-1."
  }
}

variable "compartment_ocid" {
  type        = string
  description = "Compartment OCID that will own the VCN and instance."

  validation {
    condition     = can(regex("^ocid1\\.compartment\\.", var.compartment_ocid))
    error_message = "compartment_ocid must be a compartment OCID."
  }
}

variable "ssh_public_key" {
  type        = string
  description = "OpenSSH public key installed for the ubuntu user."

  validation {
    condition     = can(regex("^(ssh-|ecdsa-)", var.ssh_public_key))
    error_message = "ssh_public_key must be an OpenSSH public key."
  }
}

variable "ssh_cidr" {
  type        = string
  description = "CIDR allowed to open TCP 22. Example: 203.0.113.10/32."

  validation {
    condition     = can(cidrhost(var.ssh_cidr, 0))
    error_message = "ssh_cidr must be a CIDR block, for example 203.0.113.10/32."
  }
}

variable "availability_domain_index" {
  type        = number
  default     = 0
  description = "Index into the region's availability domains. Use 0, 1, or 2 if an AD has no A1 capacity."

  validation {
    condition     = var.availability_domain_index == floor(var.availability_domain_index) && var.availability_domain_index >= 0 && var.availability_domain_index <= 2
    error_message = "availability_domain_index must be 0, 1, or 2."
  }
}

variable "ocpus" {
  type        = number
  default     = 2
  description = "A1 Flex OCPUs. Always Free allowance used by this stack is 2."

  validation {
    condition     = var.ocpus == floor(var.ocpus) && var.ocpus >= 1 && var.ocpus <= 2
    error_message = "ocpus must be 1 or 2."
  }
}

variable "memory_in_gbs" {
  type        = number
  default     = 12
  description = "A1 Flex memory in GB. Always Free allowance used by this stack is 12."

  validation {
    condition     = var.memory_in_gbs == floor(var.memory_in_gbs) && var.memory_in_gbs >= 1 && var.memory_in_gbs <= 12 && var.memory_in_gbs >= var.ocpus
    error_message = "memory_in_gbs must be a whole number from 1 to 12, and at least 1 GB per OCPU."
  }
}

variable "boot_volume_gbs" {
  type        = number
  default     = 50
  description = "Boot volume size. 50 GB fits the Always Free 200 GB block allowance."

  validation {
    condition     = var.boot_volume_gbs == floor(var.boot_volume_gbs) && var.boot_volume_gbs >= 50 && var.boot_volume_gbs <= 200
    error_message = "boot_volume_gbs must be a whole number from 50 to 200."
  }
}

variable "name" {
  type        = string
  default     = "arkatasks-employee-notification"
  description = "Display name prefix for the VCN, subnet, and instance."

  validation {
    condition     = can(regex("^[A-Za-z0-9_-]{1,60}$", var.name))
    error_message = "name must be 1-60 letters, numbers, hyphens, or underscores."
  }
}
