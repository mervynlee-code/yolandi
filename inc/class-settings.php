<?php
/**
 * YOLANDI Settings – WordPress Settings API integration, roles/caps, and secret rotation
 *
 * @package YOLANDI
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! class_exists( 'YOLANDI_Settings' ) ) {

class YOLANDI_Settings {

    const OPTION = 'yolandi_settings';
    const PAGE_SLUG = 'yolandi-settings';

    /**
     * Bootstrap hooks.
     */
    public static function init() : void {
        add_action( 'init',                  [ __CLASS__, 'ensure_roles_and_caps' ] );
        add_action( 'admin_init',            [ __CLASS__, 'register_settings' ] );
        add_action( 'admin_menu',            [ __CLASS__, 'register_menu' ] );
        add_action( 'admin_post_yolandi_rotate_secret', [ __CLASS__, 'handle_rotate_secret' ] );
        add_action( 'admin_notices',         [ __CLASS__, 'maybe_notice_rotated' ] );
    }

    /**
     * Default settings (mirrors queue defaults where applicable).
     */
    public static function defaults() : array {
        return [
            'max_concurrency'        => 10,
            'runner_max_concurrency' => 5,
            'lease_seconds'          => 90,
            'retries'                => 3,     // additional retries after the first attempt
            'backoff_base_ms'        => 1000,
            'backoff_max_sec'        => 300,
            'artifact_dir'           => wp_normalize_path( dirname( __DIR__ ) . '/artifacts' ),
            'default_proxy_director' => 'webshare-main',
            'default_device'         => 'Pixel7',
            'runner_secret'          => '',
        ];
    }

    /**
     * Read merged settings.
     */
    public static function get() : array {
        $opts = get_option( self::OPTION, [] );
        if ( ! is_array( $opts ) ) { $opts = []; }
        return array_merge( self::defaults(), $opts );
    }

    /**
     * Ensure custom role and capabilities exist.
     * - administrator gets all caps
     * - editor gets run_yolandi_jobs by default
     * - custom role automation_manager gets manage+run
     */
    public static function ensure_roles_and_caps() : void {
        $caps = [ 'manage_yolandi_scripts', 'manage_yolandi_jobs', 'run_yolandi_jobs' ];

        // Administrators
        if ( $admin = get_role( 'administrator' ) ) {
            foreach ( $caps as $c ) { if ( ! $admin->has_cap( $c ) ) { $admin->add_cap( $c ); } }
        }
        // Editors
        if ( $editor = get_role( 'editor' ) ) {
            if ( ! $editor->has_cap( 'run_yolandi_jobs' ) ) { $editor->add_cap( 'run_yolandi_jobs' ); }
        }
        // Custom role
        if ( ! get_role( 'automation_manager' ) ) {
            add_role( 'automation_manager', 'Automation Manager', [
                'read'                   => true,
                'manage_yolandi_scripts' => true,
                'manage_yolandi_jobs'    => true,
                'run_yolandi_jobs'       => true,
            ] );
        }
    }

    /**
     * Settings API registration.
     */
    public static function register_settings() : void {
        register_setting( 'yolandi', self::OPTION, [ __CLASS__, 'sanitize' ] );

        add_settings_section( 'yolandi_queue', __( 'Queue & Concurrency', 'yolandi' ), function() {
            echo '<p>' . esc_html__( 'Configure job leasing, retries and concurrency limits for runners.', 'yolandi' ) . '</p>';
        }, self::PAGE_SLUG );

        add_settings_field( 'max_concurrency', __( 'Global Max Concurrency', 'yolandi' ), [ __CLASS__, 'field_number' ], self::PAGE_SLUG, 'yolandi_queue', [ 'key' => 'max_concurrency', 'min' => 1, 'max' => 999, 'step' => 1 ] );
        add_settings_field( 'runner_max_concurrency', __( 'Per-Runner Max Concurrency', 'yolandi' ), [ __CLASS__, 'field_number' ], self::PAGE_SLUG, 'yolandi_queue', [ 'key' => 'runner_max_concurrency', 'min' => 1, 'max' => 50, 'step' => 1 ] );
        add_settings_field( 'lease_seconds', __( 'Lease Seconds', 'yolandi' ), [ __CLASS__, 'field_number' ], self::PAGE_SLUG, 'yolandi_queue', [ 'key' => 'lease_seconds', 'min' => 30, 'max' => 1800, 'step' => 5 ] );
        add_settings_field( 'retries', __( 'Retries (additional)', 'yolandi' ), [ __CLASS__, 'field_number' ], self::PAGE_SLUG, 'yolandi_queue', [ 'key' => 'retries', 'min' => 0, 'max' => 20, 'step' => 1 ] );

        add_settings_section( 'yolandi_backoff', __( 'Backoff Strategy', 'yolandi' ), function() {
            echo '<p>' . esc_html__( 'Exponential backoff after failures.', 'yolandi' ) . '</p>';
        }, self::PAGE_SLUG );
        add_settings_field( 'backoff_base_ms', __( 'Backoff Base (ms)', 'yolandi' ), [ __CLASS__, 'field_number' ], self::PAGE_SLUG, 'yolandi_backoff', [ 'key' => 'backoff_base_ms', 'min' => 100, 'max' => 60000, 'step' => 100 ] );
        add_settings_field( 'backoff_max_sec', __( 'Backoff Max (sec)', 'yolandi' ), [ __CLASS__, 'field_number' ], self::PAGE_SLUG, 'yolandi_backoff', [ 'key' => 'backoff_max_sec', 'min' => 1, 'max' => 3600, 'step' => 1 ] );

        add_settings_section( 'yolandi_defaults', __( 'Defaults', 'yolandi' ), function() {
            echo '<p>' . esc_html__( 'Default selections applied when a script does not specify overrides.', 'yolandi' ) . '</p>';
        }, self::PAGE_SLUG );
        add_settings_field( 'default_proxy_director', __( 'Default ProxyDirector slug', 'yolandi' ), [ __CLASS__, 'field_text' ], self::PAGE_SLUG, 'yolandi_defaults', [ 'key' => 'default_proxy_director', 'placeholder' => 'webshare-main' ] );
        add_settings_field( 'default_device', __( 'Default Device Profile', 'yolandi' ), [ __CLASS__, 'field_text' ], self::PAGE_SLUG, 'yolandi_defaults', [ 'key' => 'default_device', 'placeholder' => 'Pixel7' ] );

        add_settings_section( 'yolandi_artifacts', __( 'Artifacts', 'yolandi' ), function() {
            echo '<p>' . esc_html__( 'Where runners store screenshots/logs. On Lambda, files first land in /tmp then are uploaded to S3.', 'yolandi' ) . '</p>';
        }, self::PAGE_SLUG );
        add_settings_field( 'artifact_dir', __( 'Artifact Directory (WP host)', 'yolandi' ), [ __CLASS__, 'field_text' ], self::PAGE_SLUG, 'yolandi_artifacts', [ 'key' => 'artifact_dir', 'placeholder' => wp_normalize_path( dirname( __DIR__ ) . '/artifacts' ), 'wide' => true ] );

        add_settings_section( 'yolandi_security', __( 'Security', 'yolandi' ), function() {
            echo '<p>' . esc_html__( 'HMAC signing for runner-to-WP REST calls. Keep the secret safe; rotate as needed.', 'yolandi' ) . '</p>';
        }, self::PAGE_SLUG );
        add_settings_field( 'runner_secret', __( 'Runner HMAC Secret', 'yolandi' ), [ __CLASS__, 'field_secret' ], self::PAGE_SLUG, 'yolandi_security', [ 'key' => 'runner_secret' ] );
    }

    /**
     * Register submenu under YOLANDI.
     */
    public static function register_menu() : void {
        add_submenu_page(
            'yolandi-admin',
            __( 'YOLANDI Settings', 'yolandi' ),
            __( 'Settings', 'yolandi' ),
            'manage_yolandi_scripts',
            self::PAGE_SLUG,
            [ __CLASS__, 'render_page' ]
        );
    }

    /**
     * Settings page renderer.
     */
    public static function render_page() : void { ?>
        <div class="wrap">
            <h1><?php echo esc_html__( 'YOLANDI Settings', 'yolandi' ); ?></h1>
            <form method="post" action="options.php">
                <?php
                settings_fields( 'yolandi' );
                do_settings_sections( self::PAGE_SLUG );
                submit_button();
                ?>
            </form>
        </div>
    <?php }

    /**
     * Sanitize callback for option array.
     */
    public static function sanitize( $input ) : array {
        $out = self::get();
        $in  = is_array( $input ) ? $input : [];

        $out['max_concurrency']        = max( 1, (int) ( $in['max_concurrency'] ?? $out['max_concurrency'] ) );
        $out['runner_max_concurrency'] = max( 1, (int) ( $in['runner_max_concurrency'] ?? $out['runner_max_concurrency'] ) );
        $out['lease_seconds']          = max( 30, (int) ( $in['lease_seconds'] ?? $out['lease_seconds'] ) );
        $out['retries']                = max( 0, (int) ( $in['retries'] ?? $out['retries'] ) );

        $out['backoff_base_ms']        = max( 1, (int) ( $in['backoff_base_ms'] ?? $out['backoff_base_ms'] ) );
        $out['backoff_max_sec']        = max( 1, (int) ( $in['backoff_max_sec'] ?? $out['backoff_max_sec'] ) );

        $artifact_dir = wp_normalize_path( (string) ( $in['artifact_dir'] ?? $out['artifact_dir'] ) );
        // Prevent trailing slash duplication
        $out['artifact_dir'] = untrailingslashit( $artifact_dir );

        $out['default_proxy_director'] = sanitize_title_with_dashes( (string) ( $in['default_proxy_director'] ?? $out['default_proxy_director'] ) );
        $out['default_device']         = sanitize_text_field( (string) ( $in['default_device'] ?? $out['default_device'] ) );

        // runner_secret is not settable via this form; rotated via action
        return $out;
    }

    /* ===== Field renderers ===== */

    public static function field_number( array $args ) : void {
        $key  = $args['key'];
        $min  = isset( $args['min'] ) ? (int) $args['min'] : 0;
        $max  = isset( $args['max'] ) ? (int) $args['max'] : 999999;
        $step = isset( $args['step'] ) ? (int) $args['step'] : 1;
        $val  = (int) ( self::get()[ $key ] ?? 0 );
        printf(
            '<input type="number" name="%1$s[%2$s]" id="%2$s" value="%3$d" min="%4$d" max="%5$d" step="%6$d" class="small-text" />',
            esc_attr( self::OPTION ), esc_attr( $key ), $val, $min, $max, $step
        );
    }

    public static function field_text( array $args ) : void {
        $key   = $args['key'];
        $wide  = ! empty( $args['wide'] );
        $ph    = isset( $args['placeholder'] ) ? (string) $args['placeholder'] : '';
        $val   = (string) ( self::get()[ $key ] ?? '' );
        printf(
            '<input type="text" name="%1$s[%2$s]" id="%2$s" value="%3$s" placeholder="%4$s" class="%5$s" style="width:%6$s" />',
            esc_attr( self::OPTION ), esc_attr( $key ), esc_attr( $val ), esc_attr( $ph ), $wide ? 'regular-text' : 'small-text', $wide ? '40em' : 'auto'
        );
    }

    public static function field_secret( array $args ) : void {
        $key = $args['key'];
        $val = (string) ( self::get()[ $key ] ?? '' );
        if ( $val === '' ) {
            // generate on first use
            $val = wp_generate_password( 64, true, true );
            $opts = self::get();
            $opts['runner_secret'] = $val;
            update_option( self::OPTION, $opts );
        }
        $masked = self::mask_secret( $val );
        $url = wp_nonce_url( admin_url( 'admin-post.php?action=yolandi_rotate_secret' ), 'yolandi_rotate_secret' );
        echo '<code>' . esc_html( $masked ) . '</code> ';
        echo '<a class="button" href="' . esc_url( $url ) . '">' . esc_html__( 'Rotate Secret', 'yolandi' ) . '</a>';
        echo '<p class="description">' . esc_html__( 'Header: x-yolandi-signature. Runners must be redeployed or reconfigured after rotation.', 'yolandi' ) . '</p>';
    }

    /**
     * Action handler to rotate the HMAC secret.
     */
    public static function handle_rotate_secret() : void {
        if ( ! current_user_can( 'manage_yolandi_jobs' ) && ! current_user_can( 'manage_yolandi_scripts' ) ) {
            wp_die( __( 'Insufficient permissions', 'yolandi' ), 403 );
        }
        check_admin_referer( 'yolandi_rotate_secret' );
        $opts = self::get();
        $opts['runner_secret'] = wp_generate_password( 64, true, true );
        update_option( self::OPTION, $opts );
        wp_safe_redirect( add_query_arg( [ 'page' => self::PAGE_SLUG, 'yolandi_rotated' => 1 ], admin_url( 'admin.php' ) ) );
        exit;
    }

    /**
     * Show admin notice after rotation.
     */
    public static function maybe_notice_rotated() : void {
        if ( ! is_admin() ) return;
        if ( ! isset( $_GET['page'] ) || $_GET['page'] !== self::PAGE_SLUG ) return;
        if ( isset( $_GET['yolandi_rotated'] ) && (int) $_GET['yolandi_rotated'] === 1 ) {
            echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__( 'Runner secret rotated.', 'yolandi' ) . '</p></div>';
        }
    }

    /**
     * Mask a secret for display (keep last 4 chars).
     */
    protected static function mask_secret( string $s ) : string {
        $len = strlen( $s );
        if ( $len <= 8 ) { return str_repeat( '•', max( 0, $len - 2 ) ) . substr( $s, -2 ); }
        return str_repeat( '•', $len - 4 ) . substr( $s, -4 );
    }
}

} // class_exists guard
