output "namespace" {
  description = "Eval sandbox namespace name."
  value       = kubernetes_namespace.eval_sandbox.metadata[0].name
}

output "job_name" {
  description = "Eval gate Job name — use with kubectl logs/wait."
  value       = kubernetes_job.eval_gate.metadata[0].name
}

output "kubectl_wait" {
  description = "Wait for Job completion, then fetch logs."
  value       = "kubectl wait --for=condition=complete job/${kubernetes_job.eval_gate.metadata[0].name} -n ${var.namespace} --timeout=120s && kubectl logs job/${kubernetes_job.eval_gate.metadata[0].name} -n ${var.namespace}"
}
