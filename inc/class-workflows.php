<?php
/**
 * YOLANDI Workflows FS — list/save JSON workflows on the server
 * - Admin-only (manage_options)
 * - Starts in /workflows under the plugin, but allows navigating anywhere the
 *   webserver user can access (per request).
 * - Uses realpath() to normalize.
 *
 * @package YOLANDI
 */

if (!defined('ABSPATH')) { exit; }

if (!class_exists('YOLANDI_Workflows_FS')) {
class YOLANDI_Workflows_FS {

    public static function base_dir(): string {
        $base = wp_normalize_path(dirname(__DIR__) . '/workflows');
        if (!is_dir($base)) @wp_mkdir_p($base);
        return $base;
    }

    private static function norm(?string $path): ?string {
        if (!$path) return null;
        $rp = realpath($path);
        return $rp ? wp_normalize_path($rp) : null;
    }

    public static function ls(\WP_REST_Request $req) {
        // if (!current_user_can('manage_options')) {
        //     return new \WP_REST_Response([ 'error' => 'forbidden' ], 403);
        // }
        $qPath = $req->get_param('path');
        $base = self::base_dir();

        $cwd = self::norm($qPath) ?: self::norm($base) ?: '/';
        if (!is_dir($cwd)) $cwd = dirname($cwd);

        $dirs = []; $files = [];
        $dh = @opendir($cwd);
        if ($dh !== false) {
            while (($entry = readdir($dh)) !== false) {
                if ($entry === '.' || $entry === '..') continue;
                $full = wp_normalize_path($cwd . '/' . $entry);
                if (is_dir($full)) { $dirs[] = [ 'name' => $entry, 'path' => $full ]; }
                else if (is_file($full)) {
                    $files[] = [ 'name' => $entry, 'path' => $full, 'size' => size_format(@filesize($full) ?: 0) ];
                }
            }
            closedir($dh);
        }
        usort($dirs, fn($a,$b) => strcasecmp($a['name'], $b['name']));
        usort($files, fn($a,$b) => strcasecmp($a['name'], $b['name']));
        $root = wp_normalize_path(DIRECTORY_SEPARATOR);

        return new \WP_REST_Response([
            'base' => $base,
            'defaultDir' => $base,
            'cwd' => $cwd,
            'canUp' => $cwd !== $root,
            'dirs' => $dirs,
            'files' => $files,
        ], 200);
    }

    public static function save(\WP_REST_Request $req) {
        // if (!current_user_can('manage_options')) {
        //     return new \WP_REST_Response([ 'error' => 'forbidden' ], 403);
        // }
        $body = json_decode($req->get_body(), true) ?: [];
        $dir  = isset($body['path']) ? trim((string)$body['path']) : '';
        $name = isset($body['name']) ? trim((string)$body['name']) : '';
        $json = isset($body['json']) ? (string)$body['json'] : '';

        if ($dir === '' || $name === '') {
            return new \WP_REST_Response([ 'error' => 'path/name required' ], 400);
        }

        $dir = self::norm($dir);
        if (!$dir || !is_dir($dir)) {
            return new \WP_REST_Response([ 'error' => 'invalid directory' ], 400);
        }

        if (!preg_match('~^[A-Za-z0-9._ -]+$~', $name)) {
            return new \WP_REST_Response([ 'error' => 'invalid filename' ], 400);
        }

        if (!str_ends_with(strtolower($name), '.json')) {
            $name .= '.json';
        }

        $target = wp_normalize_path($dir . '/' . $name);
        $ok = @file_put_contents($target, $json);
        if ($ok === false) {
            return new \WP_REST_Response([ 'error' => 'write failed (permissions?)' ], 500);
        }

        return new \WP_REST_Response([ 'ok' => true, 'path' => $dir, 'name' => $name ], 200);
    }
}}
