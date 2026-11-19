terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "aws_region" {
  type    = string
  default = "eu-west-3"
}

variable "ami_id" {
  type        = string
  description = "Ubuntu AMI for this region."
}

variable "key_name" {
  type        = string
  description = "Existing EC2 key pair name."
}

variable "instance_type" {
  type    = string
  default = "t3.small"
}

variable "ssh_cidr" {
  type        = string
  default     = "0.0.0.0/0"
  description = "Replace with your IP before apply. Example: 203.0.113.10/32"
}

provider "aws" {
  region = var.aws_region
}

resource "aws_security_group" "employee" {
  name = "arkatasks-employee-notification"

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_cidr]
  }

  ingress {
    description = "Nginx"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Jenkins"
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = [var.ssh_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_ecr_repository" "employee" {
  name                 = "arkatasks-employee-notification"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_instance" "employee" {
  ami                    = var.ami_id
  instance_type          = var.instance_type
  key_name               = var.key_name
  vpc_security_group_ids = [aws_security_group.employee.id]
  user_data              = file("${path.module}/user-data.sh")

  tags = {
    Name = "arkatasks-employee-notification"
  }
}
