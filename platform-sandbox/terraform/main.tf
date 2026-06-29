resource "kubernetes_namespace" "eval_sandbox" {
  metadata {
    name = var.namespace
    labels = {
      "app.kubernetes.io/part-of" = "scanandfind-lab"
      purpose                     = "eval-sandbox"
    }
  }
}

# Runs the same eval scripts as GitHub Actions — offline, no API keys.
# @see https://kubernetes.io/docs/concepts/workloads/controllers/job/
resource "kubernetes_job" "eval_gate" {
  metadata {
    name      = "eval-gate"
    namespace = kubernetes_namespace.eval_sandbox.metadata[0].name
    labels = {
      "app.kubernetes.io/name" = "eval-gate"
    }
  }

  spec {
    backoff_limit = 2

    template {
      metadata {
        labels = {
          "app.kubernetes.io/name" = "eval-gate"
        }
      }

      spec {
        restart_policy = "Never"

        container {
          name  = "eval-runner"
          image = var.node_image

          command = ["/bin/sh", "-c"]
          args = [
            "cd ${var.lab_mount_path} && node population-eval/run-population-eval.js && node agent-routing-eval/run-agent-eval.js",
          ]

          resources {
            limits = {
              cpu    = "500m"
              memory = "256Mi"
            }
            requests = {
              cpu    = "100m"
              memory = "128Mi"
            }
          }

          volume_mount {
            name       = "lab-source"
            mount_path = var.lab_mount_path
            read_only  = true
          }
        }

        volume {
          name = "lab-source"
          host_path {
            path = var.lab_mount_path
            type = "Directory"
          }
        }
      }
    }
  }

  depends_on = [kubernetes_namespace.eval_sandbox]
}
