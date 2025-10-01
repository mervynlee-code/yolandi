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
      $id = (int) ($req['id'] ?? 0);
      $j = $req->get_json_params() ?: [];

      $runner_id = sanitize_text_field($j['runner_id'] ?? '');
      $status = sanitize_text_field($j['status'] ?? '');
      $run_ms = isset($j['run_ms']) ? (int) $j['run_ms'] : null;

      // allow array or null for error/artifacts
      $error = is_array($j['error'] ?? null) ? $j['error'] : null;
      $artifacts = is_array($j['artifacts'] ?? null) ? $j['artifacts'] : null;

      if (!$id || !$runner_id || !$status) {
        return new WP_Error('bad_request', 'id, runner_id, status required', ['status' => 400]);
      }

      $res = YOLANDI_Queue::report($id, $runner_id, $status, $error, $artifacts, $run_ms);
      if (is_wp_error($res))
        return $res;
      return rest_ensure_response($res);
    }

  }
}
