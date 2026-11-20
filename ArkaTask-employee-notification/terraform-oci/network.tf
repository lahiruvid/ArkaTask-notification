resource "oci_core_vcn" "this" {
  compartment_id = var.compartment_ocid
  display_name   = var.name
  cidr_blocks    = ["10.42.0.0/16"]
  dns_label      = "arkatasks"
}

resource "oci_core_internet_gateway" "this" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = var.name
  enabled        = true
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name}-public"

  route_rules {
    description       = "Internet via the internet gateway"
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.this.id
  }
}

locals {
  # Application ports 5432, 5672, 9411, 8761, 8083, and Jenkins 8080 are not here.
  # Jenkins is bound to 127.0.0.1 and reached with an SSH tunnel.
  ingress_rules = {
    ssh = {
      port        = 22
      source      = var.ssh_cidr
      description = "SSH"
    }
    http = {
      port        = 80
      source      = "0.0.0.0/0"
      description = "HTTP"
    }
    https = {
      port        = 443
      source      = "0.0.0.0/0"
      description = "HTTPS"
    }
  }
}

resource "oci_core_security_list" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name}-public"

  dynamic "ingress_security_rules" {
    for_each = local.ingress_rules
    content {
      description = ingress_security_rules.value.description
      protocol    = "6"
      source      = ingress_security_rules.value.source
      source_type = "CIDR_BLOCK"
      stateless   = false

      tcp_options {
        min = ingress_security_rules.value.port
        max = ingress_security_rules.value.port
      }
    }
  }

  egress_security_rules {
    description = "Outbound for apt, Docker Hub, and OCIR"
    protocol    = "all"
    destination = "0.0.0.0/0"
    stateless   = false
  }
}

# The VCN's default security list allows SSH from anywhere. Empty it so a
# future subnet cannot inherit that rule. This stack's subnet does not use it.
resource "oci_core_default_security_list" "locked" {
  manage_default_resource_id = oci_core_vcn.this.default_security_list_id
  display_name               = "${var.name}-default-locked"

  egress_security_rules {
    description = "Default list is not attached to the public subnet"
    protocol    = "all"
    destination = "0.0.0.0/0"
  }
}

resource "oci_core_subnet" "public" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.this.id
  cidr_block                 = "10.42.1.0/24"
  display_name               = "${var.name}-public"
  dns_label                  = "public"
  route_table_id             = oci_core_route_table.public.id
  security_list_ids          = [oci_core_security_list.public.id]
  prohibit_public_ip_on_vnic = false
}

resource "oci_core_network_security_group" "this" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = var.name
}

resource "oci_core_network_security_group_security_rule" "ingress" {
  for_each = local.ingress_rules

  network_security_group_id = oci_core_network_security_group.this.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = each.value.source
  source_type               = "CIDR_BLOCK"
  description               = each.value.description
  stateless                 = false

  tcp_options {
    destination_port_range {
      min = each.value.port
      max = each.value.port
    }
  }
}

resource "oci_core_network_security_group_security_rule" "egress" {
  network_security_group_id = oci_core_network_security_group.this.id
  direction                 = "EGRESS"
  protocol                  = "all"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
  description               = "Outbound for apt, Docker Hub, and OCIR"
  stateless                 = false
}
