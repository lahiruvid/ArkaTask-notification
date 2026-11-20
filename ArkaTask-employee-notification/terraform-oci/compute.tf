data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

data "oci_core_images" "ubuntu_arm" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = "VM.Standard.A1.Flex"
  state                    = "AVAILABLE"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"

  filter {
    name   = "display_name"
    values = ["^Canonical-Ubuntu-24\\.04-aarch64-.*"]
    regex  = true
  }
}

resource "oci_core_instance" "this" {
  compartment_id      = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[var.availability_domain_index].name
  display_name        = var.name
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = var.ocpus
    memory_in_gbs = var.memory_in_gbs
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu_arm.images[0].id
    boot_volume_size_in_gbs = var.boot_volume_gbs
  }

  # No ephemeral IP: OCI refuses a reserved IP on a private IP that already has one.
  # bootstrap.sh waits until the reserved IP below gives the instance a route out.
  create_vnic_details {
    subnet_id              = oci_core_subnet.public.id
    nsg_ids                = [oci_core_network_security_group.this.id]
    hostname_label         = "arkatasks"
    assign_public_ip       = false
    skip_source_dest_check = false
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data           = base64encode(file("${path.module}/bootstrap.sh"))
  }

  lifecycle {
    # A newer image or bootstrap edit must not replace the disk.
    ignore_changes = [
      source_details[0].source_id,
      metadata["user_data"],
    ]
  }
}

data "oci_core_vnic_attachments" "this" {
  compartment_id = var.compartment_ocid
  instance_id    = oci_core_instance.this.id
}

data "oci_core_private_ips" "primary" {
  vnic_id = data.oci_core_vnic_attachments.this.vnic_attachments[0].vnic_id
}

# The only public address of the instance. It survives instance replacement in the
# sense that a new instance can take it over, and the workflow uses it for SSH.
resource "oci_core_public_ip" "reserved" {
  compartment_id = var.compartment_ocid
  lifetime       = "RESERVED"
  display_name   = "${var.name}-ip"
  private_ip_id  = data.oci_core_private_ips.primary.private_ips[0].id
}
