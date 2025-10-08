<?php
// No namespace for simplicity; if you add one, update callbacks below.
if (!class_exists('YOLANDI_Security')) {
  final class YOLANDI_Security
  {
    /**
     * Basic permission check. Replace with your nonce/HMAC logic.
     */
    // public static function permission_callback($request)
    // {
    //   // DEV: allow everything so you can unblock the fatal
    //   return true;

    //   // Example: Bearer token or custom header
    //   // $hdr = $request->get_header('x-yolandi-token') ?: '';
    //   // if ($hdr && hash_equals($hdr, get_option('yolandi_api_token', ''))) {
    //   //   return true;
    //   // }
    //   // return new WP_Error('forbidden', 'Forbidden', ['status' => 403]);
    // }

    public static function verify_hmac(WP_REST_Request $req)
    {
      return true;
      $hdr = $req->get_header('x-yolandi-sig');
      if (!$hdr)
        return new WP_Error('forbidden', 'missing signature', ['status' => 403]);
      // format: t=unix,v1=hex
      $parts = [];
      foreach (explode(',', $hdr) as $kv) {
        [$k, $v] = array_map('trim', explode('=', $kv, 2));
        $parts[$k] = $v;
      }
      $t = intval($parts['t'] ?? 0);
      $sig = $parts['v1'] ?? '';
      if (abs(time() - $t) > 300)
        return new WP_Error('forbidden', 'timestamp drift', ['status' => 403]);
      $secret = (get_option('yolandi_settings')['runner_secret'] ?? '');
      $body = $req->get_body();
      $calc = hash_hmac('sha256', $t . '.' . $body, $secret);
      if (!hash_equals($calc, $sig))
        return new WP_Error('forbidden', 'bad signature', ['status' => 403]);
      return true;
    }

        // ------- DEBUG HELPERS -------
    private static function dbg($msg, \WP_REST_Request $req = null, array $extra = []) : void {
      // if (!defined('YOLANDI_DEBUG_AUTH') || !YOLANDI_DEBUG_AUTH) return;
      $bits = [
        'ip'     => $_SERVER['REMOTE_ADDR'] ?? '',
        'route'  => $req ? $req->get_route() : '',
        'method' => $_SERVER['REQUEST_METHOD'] ?? '',
        'user'   => is_user_logged_in() ? get_current_user_id() : 0,
        'caps'   => is_user_logged_in() ? array_keys( wp_get_current_user()->allcaps ?? [] ) : [],
        'hdrs'   => self::safe_headers(),
      ] + $extra;
      // var_dump('[YOLANDI_AUTH] ' . $msg . ' :: ' . wp_json_encode($bits));
    }

    private static function safe_headers() : array {
      // getallheaders() may not exist on all SAPIs
      $src = function_exists('getallheaders') ? getallheaders() : [];
      // Only log a safe subset; redact Authorization
      $keep = ['Authorization','X-WP-Nonce','X-Yolandi-Runner-Id','X-Yolandi-Ts','X-Yolandi-Sig','Origin','Referer','User-Agent'];
      $out = [];
      foreach ($keep as $k) {
        if (!empty($src[$k])) {
          $out[$k] = ($k === 'Authorization') ? (substr($src[$k],0,12) . '…') : $src[$k];
        }
      }
      return $out;
    }

    // ------- YOUR EXISTING CHECK -------
    public static function permission_callback(\WP_REST_Request $req) {
      self::dbg('permission start', $req);

      // Example flow — adapt to your current logic, but log clearly at each branch.

      // 1) Accept admin nonce
      $nonce = $req->get_header('X-WP-Nonce');
      // var_dump($nonce);
      if ($nonce) {
        $ok_nonce = wp_verify_nonce($nonce, 'wp_rest');
        self::dbg('checked nonce', $req, ['ok_nonce' => (bool)$ok_nonce]);
        if ($ok_nonce && current_user_can('manage_options')) {
          self::dbg('allow admin+nonce', $req);
          return true;
        }
      } else {
        self::dbg('no X-WP-Nonce header', $req);
      }

      // 2) If you support Application Passwords / Basic Auth
      if (is_user_logged_in()) {
        self::dbg('auth ok via WP user', $req, ['uid' => get_current_user_id()]);
        // Gate on caps if you want:
        if (current_user_can('manage_options')) return true;
        self::dbg('deny: user lacks caps', $req);
      }

      // 3) If you have a custom token / header, check and log it here
      // $token = $req->get_header('X-My-Token'); ...

      self::dbg('DENY 403', $req, ['reason' => 'no acceptable auth']);

      // Include a machine-readable reason for the client
      return new \WP_Error('forbidden', 'Unauthorized', [
        'status' => 403,
        'reason' => 'missing_auth', // change per branch to see exact failure in JSON
      ]);
    }
  }
}
