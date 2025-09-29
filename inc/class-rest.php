<?php
/**
 * YOLANDI REST API – routes for jobs, heartbeat, reporting, artifacts, and nodes bundles
 *
 * Base: /wp-json/yolandi/v1
 *
 * @package YOLANDI
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!class_exists('YOLANDI_Rest')) {

    class YOLANDI_Rest
    {

        /**
         * Hook routes at rest_api_init.
         */
        public static function init(): void
        {
            add_action('rest_api_init', [__CLASS__, 'routes']);
        }

        /**
         * Register all REST endpoints.
         */
        public static function routes(): void
        {
            /* ----------------------------- Jobs ------------------------------ */
            register_rest_route('yolandi/v1', '/jobs/enqueue', [
                'methods' => 'POST',
                'callback' => [__CLASS__, 'enqueue'],
                'permission_callback' => function () {
                    return current_user_can('manage_yolandi_jobs') || current_user_can('run_yolandi_jobs');
                },
            ]);

            register_rest_route('yolandi/v1', '/jobs/lease', [
                'methods' => 'POST',
                'callback' => [__CLASS__, 'lease'],
                'permission_callback' => ['YOLANDI_Security', 'verify_hmac'],
            ]);

            register_rest_route('yolandi/v1', '/jobs/(?P<id>\\d+)', [
                'methods' => 'GET',
                'callback' => [__CLASS__, 'get_job'],
                'permission_callback' => function () {
                    return current_user_can('manage_yolandi_jobs') || current_user_can('run_yolandi_jobs');
                },
            ]);

            register_rest_route('yolandi/v1', '/jobs/(?P<id>\\d+)/heartbeat', [
                'methods' => 'POST',
                'callback' => [__CLASS__, 'heartbeat'],
                'permission_callback' => ['YOLANDI_Security', 'verify_hmac'],
            ]);

            register_rest_route('yolandi/v1', '/jobs/(?P<id>\\d+)/report', [
                'methods' => 'POST',
                'callback' => [__CLASS__, 'report'],
                'permission_callback' => ['YOLANDI_Security', 'verify_hmac'],
            ]);

            /* --------------------------- Artifacts --------------------------- */
            register_rest_route('yolandi/v1', '/artifacts/(?P<id>\\d+)', [
                'methods' => 'GET',
                'callback' => [__CLASS__, 'artifacts_download'],
                'permission_callback' => function () {
                    return current_user_can('manage_yolandi_jobs') || current_user_can('manage_yolandi_scripts');
                },
                'args' => [
                    'path' => ['required' => true, 'type' => 'string'],
                    'disp' => ['required' => false, 'type' => 'string', 'default' => 'inline'],
                ],
            ]);

            /* ----------------------------- Nodes ----------------------------- */
            register_rest_route('yolandi/v1', '/nodes', [
                'methods' => 'GET',
                'callback' => [__CLASS__, 'nodes_list'],
                'permission_callback' => "__return_true"
                // 'permission_callback' => function () {
                //     return current_user_can('manage_yolandi_scripts');
                // },
            ]);

            register_rest_route('yolandi/v1', '/nodes/bundle', [
                'methods' => 'GET',
                'callback' => [__CLASS__, 'nodes_bundle'],
                'permission_callback' => ['YOLANDI_Security', 'verify_hmac'],
                'args' => [
                    'target' => ['required' => false, 'type' => 'string', 'default' => 'runner'],
                ],
            ]);
        }

        /* =============================== JOBS =============================== */

        /**
         * Enqueue a job.
         * Body: { script_slug, script_version, params, priority, max_attempts }
         */
        public static function enqueue(WP_REST_Request $req): WP_REST_Response|WP_Error
        {
            $p = self::json_body($req);
            $slug = isset($p['script_slug']) ? (string) $p['script_slug'] : (isset($p['scriptSlug']) ? (string) $p['scriptSlug'] : '');
            $version = isset($p['script_version']) ? (int) $p['script_version'] : (isset($p['scriptVersion']) ? (int) $p['scriptVersion'] : 1);
            $params = isset($p['params']) && is_array($p['params']) ? $p['params'] : [];
            $priority = isset($p['priority']) ? (int) $p['priority'] : 5;
            $maxAtt = isset($p['max_attempts']) ? (int) $p['max_attempts'] : null;

            if ($slug === '' || $version <= 0) {
                return new WP_Error('bad_request', 'script_slug and script_version required', ['status' => 400]);
            }
            $res = YOLANDI_Queue::enqueue($slug, $version, $params, $priority, $maxAtt);
            if (is_wp_error($res)) {
                return $res;
            }
            return new WP_REST_Response($res, 201);
        }

        /**
         * Lease a job for a runner.
         * Body: { runner_id, lease_seconds? }
         */
        public static function lease(WP_REST_Request $req): WP_REST_Response|WP_Error
        {
            $p = self::json_body($req);
            $runner = isset($p['runner_id']) ? (string) $p['runner_id'] : (isset($p['runnerId']) ? (string) $p['runnerId'] : '');
            $lease = isset($p['lease_seconds']) ? (int) $p['lease_seconds'] : (isset($p['leaseSeconds']) ? (int) $p['leaseSeconds'] : 0);
            if ($runner === '') {
                return new WP_Error('bad_request', 'runner_id required', ['status' => 400]);
            }
            if ($lease <= 0) {
                $lease = (int) (YOLANDI_Queue::settings()['lease_seconds'] ?? 90);
            }
            $job = YOLANDI_Queue::lease($lease, $runner);
            if (!$job) {
                return new WP_REST_Response(null, 204);
            }
            return new WP_REST_Response($job, 200);
        }

        /** Get a single job by id. */
        public static function get_job(WP_REST_Request $req): WP_REST_Response|WP_Error
        {
            $id = (int) $req['id'];
            $row = YOLANDI_Queue::get($id);
            if (!$row) {
                return new WP_Error('not_found', 'Job not found', ['status' => 404]);
            }
            return new WP_REST_Response($row, 200);
        }

        /**
         * Heartbeat: extend lease for a running job.
         * Body: { runner_id, lease_seconds? }
         */
        public static function heartbeat(WP_REST_Request $req): WP_REST_Response|WP_Error
        {
            $id = (int) $req['id'];
            $p = self::json_body($req);
            $runner = isset($p['runner_id']) ? (string) $p['runner_id'] : (isset($p['runnerId']) ? (string) $p['runnerId'] : '');
            $lease = isset($p['lease_seconds']) ? (int) $p['lease_seconds'] : (isset($p['leaseSeconds']) ? (int) $p['leaseSeconds'] : 0);
            if ($runner === '') {
                return new WP_Error('bad_request', 'runner_id required', ['status' => 400]);
            }
            if ($lease <= 0) {
                $lease = (int) (YOLANDI_Queue::settings()['lease_seconds'] ?? 90);
            }
            $ok = YOLANDI_Queue::heartbeat($id, $runner, $lease);
            return new WP_REST_Response(['ok' => (bool) $ok], $ok ? 200 : 409);
        }

        /**
         * Report: succeeded/failed with optional error/artifacts.
         * Body: { runner_id, status:"succeeded|failed", error?, artifacts?, run_ms? }
         */
        public static function report(WP_REST_Request $req): WP_REST_Response|WP_Error
        {
            $id = (int) $req['id'];
            $p = self::json_body($req);
            $runner = isset($p['runner_id']) ? (string) $p['runner_id'] : (isset($p['runnerId']) ? (string) $p['runnerId'] : '');
            $status = isset($p['status']) ? (string) $p['status'] : '';
            $error = isset($p['error']) && is_array($p['error']) ? $p['error'] : null;
            $art = isset($p['artifacts']) && is_array($p['artifacts']) ? $p['artifacts'] : null;
            $run_ms = isset($p['run_ms']) ? (int) $p['run_ms'] : (isset($p['runMs']) ? (int) $p['runMs'] : null);

            if ($runner === '' || ($status !== 'succeeded' && $status !== 'failed')) {
                return new WP_Error('bad_request', 'runner_id and valid status required', ['status' => 400]);
            }
            $res = YOLANDI_Queue::report($id, $runner, $status, $error, $art, $run_ms);
            if (is_wp_error($res)) {
                return $res;
            }
            return new WP_REST_Response($res, 200);
        }

        /* ============================ ARTIFACTS ============================= */

        /** Stream an artifact file. Query: ?path=rel&disp=inline|attachment */
        public static function artifacts_download(WP_REST_Request $req)
        {
            $id = (int) $req['id'];
            $path = (string) $req->get_param('path');
            $disp = (string) ($req->get_param('disp') ?: 'inline');
            $res = YOLANDI_Artifacts::stream($id, $path, $disp);
            if (is_wp_error($res)) {
                return $res;
            }
            return null; // streaming already handled
        }

        /* =============================== NODES ============================== */

        /**
         * List node modules found under /nodes.
         * Returns: [ { path, meta } ]
         */
        public static function nodes_list(WP_REST_Request $req): WP_REST_Response|WP_Error
        {
            if (class_exists('YOLANDI_Nodes') && method_exists('YOLANDI_Nodes', 'list')) {
                $data = YOLANDI_Nodes::list();
                return new WP_REST_Response($data, 200);
            }
            // Fallback: scan directory and try to read meta via regex (lightweight)
            $dir = wp_normalize_path(dirname(__DIR__) . '/nodes');
            if (!is_dir($dir)) {
                return new WP_REST_Response([], 200);
            }
            $out = [];
            foreach (glob($dir . '/*.mjs') as $abs) {
                $meta = self::extract_meta_from_node($abs);
                $out[] = ['path' => basename($abs), 'meta' => $meta];
            }
            return new WP_REST_Response($out, 200);
        }

        /**
         * Return nodes bundle as a ZIP containing index.mjs and all modules.
         * Uses ETag for caching. Auth via HMAC header.
         */
        public static function nodes_bundle(WP_REST_Request $req)
        {
            if (class_exists('YOLANDI_Nodes') && method_exists('YOLANDI_Nodes', 'bundle')) {
                return YOLANDI_Nodes::bundle($req);
            }
            $dir = wp_normalize_path(dirname(__DIR__) . '/nodes');
            if (!is_dir($dir)) {
                return new WP_Error('not_found', 'nodes dir missing', ['status' => 404]);
            }

            $files = glob($dir . '/*.mjs');
            sort($files);
            $etag = self::build_etag($files);

            $ifNone = isset($_SERVER['HTTP_IF_NONE_MATCH']) ? trim((string) $_SERVER['HTTP_IF_NONE_MATCH']) : '';
            if ($ifNone !== '' && $ifNone === $etag) {
                status_header(304);
                return null;
            }

            // Build a zip in memory
            $zip = new ZipArchive();
            $tmp = wp_tempnam('yolandi-nodes');
            if (true !== $zip->open($tmp, ZipArchive::OVERWRITE)) {
                return new WP_Error('io_error', 'Failed to open zip');
            }
            $index = "export const registry = {}\n";
            foreach ($files as $abs) {
                $name = basename($abs);
                $src = file_get_contents($abs);
                if ($src === false) {
                    continue;
                }
                $zip->addFromString($name, $src);
                // index exports lazy imports at runtime (runners can import normally after unzip)
                $type = self::extract_meta_from_node($abs)['type'] ?? pathinfo($name, PATHINFO_FILENAME);
                $index .= "import * as m_" . self::safe_ident($name) . " from './$name'\n";
                $index .= "registry['$type'] = { ...m_" . self::safe_ident($name) . " }\n";
            }
            $zip->addFromString('index.mjs', $index);
            $zip->close();

            // Stream response
            header('Content-Type: application/zip');
            header('Content-Length: ' . (string) filesize($tmp));
            header('ETag: ' . $etag);
            readfile($tmp);
            @unlink($tmp);
            return null;
        }

        /* ============================== Helpers ============================= */

        protected static function json_body(WP_REST_Request $req): array
        {
            $raw = $req->get_body();
            if (is_string($raw) && $raw !== '') {
                $j = json_decode($raw, true);
                if (is_array($j)) {
                    return $j;
                }
            }
            return (array) $req->get_json_params();
        }

        // Robustly parse `export const meta = { ... }` from a .mjs file
        // Robustly parse `export const meta = { ... }` from a .mjs file (single quotes ok)
// Parse `export const meta = { ... }` robustly (handles comments, single quotes, trailing commas)
// Robustly parse `export const meta = { ... }` from a .mjs file
        protected static function extract_meta_from_node(string $abs): array
        {
            $src = @file_get_contents($abs);
            if (!is_string($src)) {
                return [];
            }

            // Capture a balanced {...} after "export const meta ="
            // Uses recursive subpattern (?1) so nested objects are handled.
            if (!preg_match('/export\s+const\s+meta\s*=\s*(\{(?:[^{}]|(?1))*\})\s*;?/m', $src, $m)) {
                return [];
            }
            $obj = $m[1];

            // 1) strip comments
            $obj = preg_replace('!/\*.*?\*/!s', '', $obj);          // /* ... */
            $obj = preg_replace('![ \t]*//.*$!m', '', $obj);        // // ...

            // 2) quote unquoted keys: { type: "x" } -> { "type": "x" }
            // (doesn't touch already-quoted keys)
            $obj = preg_replace_callback(
                '/([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/',
                static function ($mm) {
                    return $mm[1] . '"' . $mm[2] . '":';
                },
                $obj
            );

            // 3) remove trailing commas: { "a":1, } or [1,2,]
            $obj = preg_replace('/,(\s*[}\]])/', '$1', $obj);

            // IMPORTANT: meta values should use double-quoted strings in your .mjs.
            // (If you used single quotes inside meta, switch them to double quotes.)

            $meta = json_decode($obj, true);
            return is_array($meta) ? $meta : [];
        }


        protected static function build_etag(array $files): string
        {
            $h = hash_init('sha256');
            foreach ($files as $f) {
                $st = @stat($f);
                hash_update($h, basename($f) . '|' . ($st['size'] ?? 0) . '|' . ($st['mtime'] ?? 0));
            }
            return 'W/"' . hash_final($h) . '"';
        }

        protected static function safe_ident(string $name): string
        {
            return preg_replace('/[^A-Za-z0-9_]/', '_', $name);
        }
    }

} // class_exists guard
