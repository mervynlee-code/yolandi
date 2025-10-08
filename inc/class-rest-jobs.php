<?php
if (!class_exists('YOLANDI_Rest_Jobs')) {
  final class YOLANDI_Rest_Jobs
  {
    // Defensive aliases — safe no matter how the route is registered.
    public static function lease(\WP_REST_Request $req)
    {
      return self::rest_lease($req);
    }
    public static function heartbeat(\WP_REST_Request $req)
    {
      return self::rest_heartbeat($req);
    }
    public static function report(\WP_REST_Request $req)
    {
      return self::rest_report($req);
    }

    // Accepts WP_REST_Request, calls self::lease(int, string)
    public static function rest_lease(WP_REST_Request $req)
    {
      // var_dump($req);
      $j = $req->get_json_params() ?: [];
      $runner_id = sanitize_text_field($j['runner_id'] ?? '');

      // var_dump($runner_id);
      if (!$runner_id)
        $runner_id = 'runner-unknown';
      $lease_seconds = isset($j['lease_seconds']) ? (int) $j['lease_seconds'] : (int) YOLANDI_Queue::settings()['lease_seconds'];

      $job = YOLANDI_Queue::lease($lease_seconds, $runner_id);
      if (!$job)
        return new WP_REST_Response(null, 204); // no jobs available
      return rest_ensure_response($job);
    }

    // Accepts WP_REST_Request, calls self::heartbeat(int, string, int)
    public static function rest_heartbeat(WP_REST_Request $req)
    {
      $id = (int) ($req['id'] ?? 0);
      $j = $req->get_json_params() ?: [];
      $runner_id = sanitize_text_field($j['runner_id'] ?? '');
      $lease_seconds = isset($j['lease_seconds']) ? (int) $j['lease_seconds'] : (int) YOLANDI_Queue::settings()['lease_seconds'];

      if (!$id || !$runner_id) {
        return new WP_Error('bad_request', 'id and runner_id required', ['status' => 400]);
      }

      $ok = YOLANDI_Queue::heartbeat($id, $runner_id, $lease_seconds);
      // If you later add pause/resume control, include it here (e.g., from a column).
      return rest_ensure_response(['ok' => (bool) $ok]);
    }

    // Accepts WP_REST_Request, calls self::report(int, string, string, ?array, ?array, ?int)
    public static function rest_report(WP_REST_Request $req)
    {
      $id = (int) $req['id'];

      // Read from WP_REST_Request (works with JSON, form, query)
      $status = (string) $req->get_param('status');
      $runner_id = (string) $req->get_param('runner_id');
      $error = $req->get_param('error');
      $artifacts = $req->get_param('artifacts');
      $run_ms = $req->get_param('run_ms');

      // Accept progress too
      $allowed = ['succeeded', 'failed', 'progress'];
      // if (empty($runner_id) || !in_array($status, $allowed, true)) {
      //   return new WP_Error('bad_request', 'runner_id and valid status required', ['status' => 400]);
      // }

      // If artifacts arrived as a JSON string, decode it
      if (is_string($artifacts) && $artifacts !== '') {
        $decoded = json_decode($artifacts, true);
        if (json_last_error() === JSON_ERROR_NONE)
          $artifacts = $decoded;
      }
      if (!is_array($artifacts))
        $artifacts = [];

      // Capture any extra keys the runner sent (event, nodeId, etc.)
      $json = $req->get_json_params() ?: [];
      $known = ['status' => 1, 'runner_id' => 1, 'error' => 1, 'artifacts' => 1, 'run_ms' => 1];
      $extras = array_diff_key($json, $known);
      if ($extras) {
        if (!isset($artifacts['logs']) || !is_array($artifacts['logs'])) {
          $artifacts['logs'] = [];
        }
        $artifacts['logs'][] = array_merge(['ts' => gmdate('c'), '_status' => $status], $extras);
      }

      $res = YOLANDI_Queue::report(
        $id,
        $runner_id,
        $status,
        is_array($error) ? $error : null,
        $artifacts ?: null,
        is_numeric($run_ms) ? (int) $run_ms : null
      );

      if (is_wp_error($res)) {
        return new WP_Error('report_failed', $res->get_error_message(), ['status' => 400]);
      }
      return rest_ensure_response($res);
    }
  }
}
