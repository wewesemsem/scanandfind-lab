variable "kubeconfig_path" {
  description = "Path to kubeconfig (default: kind context after platform:cluster)."
  type        = string
  default     = "~/.kube/config"
}

variable "kube_context" {
  description = "kubectl context for the local kind cluster."
  type        = string
  default     = "kind-eval-lab"
}

variable "namespace" {
  description = "Isolated namespace for CI-style eval Jobs (not user traffic)."
  type        = string
  default     = "eval-sandbox"
}

variable "lab_mount_path" {
  description = "Path inside the kind node where repo root is mounted (kind-config.yaml)."
  type        = string
  default     = "/lab"
}

variable "node_image" {
  description = "Node.js image for eval Job (matches CI Node 20)."
  type        = string
  default     = "node:20-alpine"
}
