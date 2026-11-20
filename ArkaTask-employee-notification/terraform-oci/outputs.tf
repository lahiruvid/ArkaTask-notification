output "public_ip" {
  description = "Reserved public IPv4 address of the instance."
  value       = oci_core_public_ip.reserved.ip_address
}

output "ssh_command" {
  description = "SSH to the ubuntu user. Replace the key path."
  value       = "ssh -i <path-to-private-key> ubuntu@${oci_core_public_ip.reserved.ip_address}"
}

output "jenkins_tunnel" {
  description = "Forward Jenkins. It listens on 127.0.0.1:8080 only."
  value       = "ssh -i <path-to-private-key> -L 8080:127.0.0.1:8080 ubuntu@${oci_core_public_ip.reserved.ip_address}"
}

output "image_name" {
  description = "Ubuntu aarch64 image selected for this apply."
  value       = data.oci_core_images.ubuntu_arm.images[0].display_name
}
