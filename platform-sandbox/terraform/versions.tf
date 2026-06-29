terraform {
  required_version = ">= 1.5.0"

  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.35"
    }
  }

  # Local backend — no cloud account or remote state bucket required.
  # @see https://developer.hashicorp.com/terraform/language/state
  backend "local" {}
}
