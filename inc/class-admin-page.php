<?php
/**
 * YOLANDI Admin Page – mounts the React SPA inside WP-Admin and enqueues assets (ES module)
 *
 * @package YOLANDI
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!class_exists('YOLANDI_Admin_Page')) {

    class YOLANDI_Admin_Page
    {

        const SLUG = 'yolandi-admin';

        /** Bootstrap hooks. */
        public static function init(): void
        {
            add_action('admin_menu', [__CLASS__, 'register_menu']);
            add_action('admin_enqueue_scripts', [__CLASS__, 'enqueue_assets']);
        }

        /** Register a top-level admin menu. */
        public static function register_menu(): void
        {
            if (!current_user_can('manage_yolandi_scripts')) {
                return;
            }
            $hook = add_menu_page(
                __('YOLANDI', 'yolandi'),
                __('YOLANDI', 'yolandi'),
                'manage_yolandi_scripts',
                self::SLUG,
                [__CLASS__, 'render_root'],
                'dashicons-media-code',
                59
            );
        }

        /** Echo the SPA mount point. */
        public static function render_root(): void
        {
            ?>
            <div id="yolandi-root" style="min-height: calc(100vh - 150px);">
                <noscript><?php echo esc_html__('This page requires JavaScript.', 'yolandi'); ?></noscript>
            </div>
        <?php }

        /** Enqueue built JS/CSS only on our page. Also boot the SPA with runtime config. */
        public static function enqueue_assets(string $hook): void
        {
            if ($hook !== 'toplevel_page_' . self::SLUG) {
                return;
            }

            $css_rel = '../admin/dist/admin.css';
            $js_rel = '../admin/dist/admin.js';

            $css_url = plugins_url($css_rel, __FILE__);
            $js_url = plugins_url($js_rel, __FILE__);

            $css_abs = wp_normalize_path(dirname(__DIR__) . '/admin/dist/admin.css');
            $js_abs = wp_normalize_path(dirname(__DIR__) . '/admin/dist/admin.js');

            $css_v = self::file_mtime_version($css_abs);
            $js_v = self::file_mtime_version($js_abs);

            if (file_exists($css_abs)) {
                wp_enqueue_style('yolandi-admin', $css_url, [], $css_v);
            }

            $nonce = wp_create_nonce('wp_rest');

            // ---- Inline config (must run BEFORE the module) ----
            $cfg = [
                'version' => defined('YOLANDI_VERSION') ? YOLANDI_VERSION : '0.0.0',
                'restRoot' => esc_url_raw(rest_url('yolandi/v1')),
                'wpRestNonce' => $nonce,
                'caps' => [
                    'manage_scripts' => current_user_can('manage_yolandi_scripts'),
                    'manage_jobs' => current_user_can('manage_yolandi_jobs'),
                    'run_jobs' => current_user_can('run_yolandi_jobs'),
                ],
                'paths' => [
                    'pluginUrl' => trailingslashit(plugins_url('', dirname(__FILE__) . '/yolandi.php')),
                    'pluginDir' => trailingslashit(wp_normalize_path(plugin_dir_path(dirname(__FILE__) . '/yolandi.php'))),
                ],
            ];
            $inline_cfg = 'window.YOLANDI_CONFIG = ' . wp_json_encode($cfg, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . ';';

            // ---- Preferred: WP 6.5+ module API ----
            if (function_exists('wp_register_script_module') && function_exists('wp_enqueue_script_module')) {
                // Print inline config as its own <script type="module"> BEFORE the module.
                add_action('admin_print_scripts', function () use ($inline_cfg) {
                    echo '<script type="module">' . $inline_cfg . '</script>' . "\n";
                }, 9);

                wp_register_script_module('yolandi-admin', $js_url, [], $js_v);
                wp_enqueue_script_module('yolandi-admin');
                return;
            }

            // ---- Fallback: classic enqueue + force type="module" ----
            $handle = 'yolandi-admin';
            wp_enqueue_script($handle, $js_url, [], $js_v, true);

            // Inline config BEFORE the module
            wp_add_inline_script($handle, $inline_cfg, 'before');

            // Try core API first…
            if (function_exists('wp_script_add_data')) {
                wp_script_add_data($handle, 'type', 'module');
            }

            // …and belt-and-suspenders: force-override the tag if something strips it.
            add_filter('script_loader_tag', function ($tag, $h) use ($handle) {
                if ($h === $handle) {
                    // Ensure exactly one type="module"
                    if (strpos($tag, 'type="module"') === false) {
                        $tag = preg_replace('/<script /', '<script type="module" ', $tag, 1);
                    }
                }
                return $tag;
            }, 10, 2);

            wp_localize_script('yolandi-admin', 'wpApiSettings', [
                'root' => esc_url_raw(rest_url()),
                'nonce' => $nonce,
            ]);

            add_action('admin_enqueue_scripts', function () {
                wp_localize_script(
                    'yolandi-admin',
                    'YOLANDI_REST',
                    ['root' => esc_url_raw(rest_url()), 'nonce' => wp_create_nonce('wp_rest')]
                );
            });
        }


        /** Helper: version from file mtime if available, else plugin version. */
        protected static function file_mtime_version(string $abs): string
        {
            if (file_exists($abs)) {
                return (string) filemtime($abs);
            }
            return defined('YOLANDI_VERSION') ? YOLANDI_VERSION : '0.0.0';
        }
    }

} // class_exists
