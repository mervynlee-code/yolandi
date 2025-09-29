<?php
// yolandi.php
register_activation_hook(__FILE__, function () {
global $wpdb;
$table = $wpdb->prefix . 'yolandi_jobs';
$charset = $wpdb->get_charset_collate();
$sql = "CREATE TABLE IF NOT EXISTS `$table` (
`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
`script_slug` VARCHAR(190) NOT NULL,
`script_version` INT NOT NULL,
`params_json` JSON NULL,
`priority` TINYINT UNSIGNED NOT NULL DEFAULT 5,
`status` ENUM('queued','running','retrying','succeeded','failed','dead_letter') NOT NULL DEFAULT 'queued',
`attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
`max_attempts` TINYINT UNSIGNED NOT NULL DEFAULT 3,
`lease_expires_at` DATETIME NULL,
`runner_id` VARCHAR(64) NULL,
`error_json` JSON NULL,
`artifacts_json` JSON NULL,
`created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
`updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
KEY `idx_status_priority_created` (`status`,`priority`,`created_at`),
KEY `idx_lease` (`status`,`lease_expires_at`),
KEY `idx_script` (`script_slug`,`script_version`)
) $charset;";
require_once ABSPATH . 'wp-admin/includes/upgrade.php';
dbDelta($sql);


// Defaults
add_option('yolandi_settings', [
'max_concurrency' => 10,
'runner_max_concurrency' => 5,
'lease_seconds' => 90,
'retries' => 3,
'backoff_base_ms' => 1000,
'backoff_max_sec' => 300,
'artifact_dir' => WP_PLUGIN_DIR . '/yolandi/artifacts',
'default_proxy_director' => 'webshare-main',
'default_device' => 'Pixel7',
'runner_secret' => wp_generate_password(64, true, true),
], '', false);


if (!wp_next_scheduled('yolandi_queue_watchdog')) {
wp_schedule_event(time()+60, 'minute', 'yolandi_queue_watchdog');
}
});