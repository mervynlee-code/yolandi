<?php
// class-nodes.php 
/**
 * YOLANDI Nodes – discovery & bundling of custom node modules + local libs
 *
 * This class backs the /yolandi/v1/nodes and /yolandi/v1/nodes/bundle endpoints.
 * It scans wp-content/plugins/yolandi/nodes/*.mjs and (optionally) includes
 * the local library directory wp-content/plugins/yolandi/lib/stealth-api/** in
 * the runner bundle so node modules can import from "../lib/stealth-api/...".
 *
 * @package YOLANDI
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!class_exists('YOLANDI_Nodes')) {

    class YOLANDI_Nodes
    {

        /** Directory holding node .mjs files. */
        public static function nodes_dir(): string
        {
            return wp_normalize_path(dirname(__DIR__) . '/nodes');
        }

        /** Optional local library root to include in bundles. */
        public static function local_lib_root(): string
        {
            return wp_normalize_path(dirname(__DIR__) . '/lib/stealth-api');
        }

        /**
         * Recursively find all .mjs files under $root.
         * Returns array of [abs, rel] where rel is the path relative to $root.
         */
        protected static function find_mjs_files(string $root): array
        {
            $root = wp_normalize_path($root);
            if (!is_dir($root)) { return []; }

            $it = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator(
                    $root,
                    FilesystemIterator::SKIP_DOTS | FilesystemIterator::FOLLOW_SYMLINKS
                ),
                RecursiveIteratorIterator::LEAVES_ONLY
            );

            $out = [];
            foreach ($it as $file) {
                /** @var SplFileInfo $file */
                if (!$file->isFile()) { continue; }
                $abs = wp_normalize_path($file->getPathname());
                // Skip heavy/unwanted dirs
                if (strpos($abs, '/.git/') !== false || strpos($abs, '/node_modules/') !== false) { continue; }
                if (strtolower(pathinfo($abs, PATHINFO_EXTENSION)) !== 'mjs') { continue; }
                $rel = ltrim(substr($abs, strlen($root)), '/');
                $out[] = [$abs, str_replace('\\', '/', $rel)];
            }

            usort($out, static function ($a, $b) {
                return strcmp($a[1], $b[1]); // sort by relative path for stable order
            });
            return $out;
        }

        /** List discovered nodes with meta. (Now recursive) */
        public static function list(): array
        {
            $dir = self::nodes_dir();
            if (!is_dir($dir)) {
                return [];
            }
            $out = [];
            foreach (self::find_mjs_files($dir) as [$abs, $rel]) {
                $meta = self::extract_meta_from_node($abs);
                $out[] = [
                    'path' => $rel,  // preserve subdirectory path
                    'meta' => $meta,
                ];
            }
            return $out;
        }

        /**
         * Build and stream a zip bundle with nodes and local lib for runners.
         * Auth is enforced by the REST route permission callback.
         * (Now recursive; subfolder structure preserved in zip)
         */
        public static function bundle(WP_REST_Request $req)
        {
            $nodesDir = self::nodes_dir();
            if (!is_dir($nodesDir)) {
                return new WP_Error('not_found', 'nodes directory missing', ['status' => 404]);
            }

            // Collect node files recursively: [ [abs, rel], ... ]
            $nodePairs = self::find_mjs_files($nodesDir);

            // Optional: include the local library (recursively) so nodes can import relatively
            $libRoot = self::local_lib_root();
            $libFiles = [];
            if (is_dir($libRoot)) {
                $iter = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($libRoot, FilesystemIterator::SKIP_DOTS));
                foreach ($iter as $file) {
                    if ($file instanceof SplFileInfo && $file->isFile()) {
                        $libFiles[] = wp_normalize_path($file->getPathname());
                    }
                }
                sort($libFiles);
            }

            // Build ETag across all absolute files (nodes + lib)
            $etag = self::build_etag(array_merge(array_map(static function ($p) { return $p[0]; }, $nodePairs), $libFiles));
            $ifNone = isset($_SERVER['HTTP_IF_NONE_MATCH']) ? trim((string) $_SERVER['HTTP_IF_NONE_MATCH']) : '';
            if ($ifNone !== '' && $ifNone === $etag) {
                status_header(304);
                return null;
            }

            $zip = new ZipArchive();
            $tmp = wp_tempnam('yolandi-nodes');
            if (true !== $zip->open($tmp, ZipArchive::OVERWRITE)) {
                return new WP_Error('io_error', 'Failed to open zip');
            }

            // Add node files under their relative paths; generate index importing those paths.
            $index = "export const registry = {}\n";
            foreach ($nodePairs as [$abs, $rel]) {
                $src = file_get_contents($abs);
                if ($src === false) {
                    continue;
                }
                $zip->addFromString($rel, $src);
                $meta = self::extract_meta_from_node($abs);
                $type = $meta['type'] ?? pathinfo($rel, PATHINFO_FILENAME);
                $ident = self::safe_ident($rel); // alias for import
                $index .= "import * as m_" . $ident . " from './" . $rel . "'\n";
                $index .= "registry['" . addslashes($type) . "'] = { ...m_" . $ident . " }\n";
            }

            // Add local library under ./lib/stealth-api/**
            $libPrefix = 'lib/stealth-api/';
            foreach ($libFiles as $abs) {
                $rel = substr($abs, strlen($libRoot));
                $rel = ltrim(str_replace('\\', '/', $rel), '/');
                $zip->addFile($abs, $libPrefix . $rel);
            }

            $zip->addFromString('index.mjs', $index);
            $zip->close();

            header('Content-Type: application/zip');
            header('Content-Length: ' . (string) filesize($tmp));
            header('ETag: ' . $etag);
            readfile($tmp);
            @unlink($tmp);
            return null;
        }

        /* ------------------------------- Helpers ------------------------------- */

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
