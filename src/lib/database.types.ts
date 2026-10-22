export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_deletion_queue: {
        Row: {
          attempts: number
          last_error: string | null
          locked_at: string | null
          next_attempt_at: string
          requested_at: string
          requested_by: string
          status: string
          user_id: string
        }
        Insert: {
          attempts?: number
          last_error?: string | null
          locked_at?: string | null
          next_attempt_at?: string
          requested_at?: string
          requested_by: string
          status?: string
          user_id: string
        }
        Update: {
          attempts?: number
          last_error?: string | null
          locked_at?: string | null
          next_attempt_at?: string
          requested_at?: string
          requested_by?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          id: number
          target_id: string | null
          target_type: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: never
          target_id?: string | null
          target_type: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: never
          target_id?: string | null
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_page_views: {
        Row: {
          authenticated_views: number
          total_views: number
          updated_at: string
          view_date: string
        }
        Insert: {
          authenticated_views?: number
          total_views?: number
          updated_at?: string
          view_date: string
        }
        Update: {
          authenticated_views?: number
          total_views?: number
          updated_at?: string
          view_date?: string
        }
        Relationships: []
      }
      faq_items: {
        Row: {
          answer_en: string
          answer_zh: string
          created_at: string
          id: string
          is_visible: boolean
          question_en: string
          question_zh: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          answer_en?: string
          answer_zh: string
          created_at?: string
          id?: string
          is_visible?: boolean
          question_en?: string
          question_zh: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          answer_en?: string
          answer_zh?: string
          created_at?: string
          id?: string
          is_visible?: boolean
          question_en?: string
          question_zh?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      forum_posts: {
        Row: {
          author_id: string | null
          author_username: string
          body: string
          created_at: string
          id: string
          kind: string
          title: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          author_username?: string
          body: string
          created_at?: string
          id?: string
          kind: string
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          author_username?: string
          body?: string
          created_at?: string
          id?: string
          kind?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      game_servers: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string | null
          map_url: string | null
          max_players: number
          name: string
          online_players: number
          slug: string
          status: string
          updated_at: string
          version: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string | null
          map_url?: string | null
          max_players?: number
          name: string
          online_players?: number
          slug: string
          status?: string
          updated_at?: string
          version?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string | null
          map_url?: string | null
          max_players?: number
          name?: string
          online_players?: number
          slug?: string
          status?: string
          updated_at?: string
          version?: string | null
        }
        Relationships: []
      }
      map_claim_cells: {
        Row: {
          chunk_column: number
          chunk_row: number
          claim_id: string
          created_at: string
          map_id: string
        }
        Insert: {
          chunk_column: number
          chunk_row: number
          claim_id: string
          created_at?: string
          map_id: string
        }
        Update: {
          chunk_column?: number
          chunk_row?: number
          claim_id?: string
          created_at?: string
          map_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "map_claim_cells_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "map_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "map_claim_cells_map_id_fkey"
            columns: ["map_id"]
            isOneToOne: false
            referencedRelation: "town_maps"
            referencedColumns: ["id"]
          },
        ]
      }
      map_claims: {
        Row: {
          color: string
          created_at: string
          description: string
          id: string
          map_id: string
          minecraft_username: string
          owner_id: string
          project_name: string
          status: string
          updated_at: string
        }
        Insert: {
          color: string
          created_at?: string
          description?: string
          id?: string
          map_id: string
          minecraft_username: string
          owner_id: string
          project_name: string
          status?: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string
          id?: string
          map_id?: string
          minecraft_username?: string
          owner_id?: string
          project_name?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "map_claims_map_id_fkey"
            columns: ["map_id"]
            isOneToOne: false
            referencedRelation: "town_maps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "map_claims_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      map_markers: {
        Row: {
          color: string
          created_at: string
          created_by: string
          description: string
          icon_type: string
          id: string
          map_id: string
          name: string
          pixel_x: number
          pixel_y: number
          updated_at: string
        }
        Insert: {
          color: string
          created_at?: string
          created_by: string
          description?: string
          icon_type: string
          id?: string
          map_id: string
          name: string
          pixel_x: number
          pixel_y: number
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string
          description?: string
          icon_type?: string
          id?: string
          map_id?: string
          name?: string
          pixel_x?: number
          pixel_y?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "map_markers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "map_markers_map_id_fkey"
            columns: ["map_id"]
            isOneToOne: false
            referencedRelation: "town_maps"
            referencedColumns: ["id"]
          },
        ]
      }
      material_assignments: {
        Row: {
          amount: number
          claimant_id: string | null
          claimant_username: string
          completed: boolean
          completed_at: string | null
          created_at: string
          id: string
          item_id: string
          note: string
          updated_at: string
          updated_by: string | null
          updated_by_username: string
        }
        Insert: {
          amount: number
          claimant_id?: string | null
          claimant_username: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          id?: string
          item_id: string
          note?: string
          updated_at?: string
          updated_by?: string | null
          updated_by_username?: string
        }
        Update: {
          amount?: number
          claimant_id?: string | null
          claimant_username?: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          id?: string
          item_id?: string
          note?: string
          updated_at?: string
          updated_by?: string | null
          updated_by_username?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_assignments_claimant_id_fkey"
            columns: ["claimant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_assignments_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "material_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_assignments_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      material_items: {
        Row: {
          id: string
          image_url: string | null
          initial_available_count: number
          item_id: string
          mismatched_count: number
          name_en: string
          name_zh: string
          project_id: string
          sort_order: number
          source_missing_count: number
          total_count: number
        }
        Insert: {
          id?: string
          image_url?: string | null
          initial_available_count: number
          item_id: string
          mismatched_count?: number
          name_en: string
          name_zh: string
          project_id: string
          sort_order?: number
          source_missing_count: number
          total_count: number
        }
        Update: {
          id?: string
          image_url?: string | null
          initial_available_count?: number
          item_id?: string
          mismatched_count?: number
          name_en?: string
          name_zh?: string
          project_id?: string
          sort_order?: number
          source_missing_count?: number
          total_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "material_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "material_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      material_projects: {
        Row: {
          created_at: string
          creator_id: string | null
          creator_username: string
          id: string
          name: string
          priority: number
          source_date: string
          source_title: string
          storage_location: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          creator_id?: string | null
          creator_username: string
          id?: string
          name: string
          priority?: number
          source_date?: string
          source_title?: string
          storage_location?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          creator_id?: string | null
          creator_username?: string
          id?: string
          name?: string
          priority?: number
          source_date?: string
          source_title?: string
          storage_location?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_projects_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      player_profiles: {
        Row: {
          first_seen_at: string
          id: string
          last_seen_at: string
          metadata: Json
          minecraft_uuid: string
          playtime_seconds: number
          updated_at: string
          username: string
        }
        Insert: {
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          metadata?: Json
          minecraft_uuid: string
          playtime_seconds?: number
          updated_at?: string
          username: string
        }
        Update: {
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          metadata?: Json
          minecraft_uuid?: string
          playtime_seconds?: number
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          must_change_password: boolean
          qq_registration_pending: boolean
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          id: string
          must_change_password?: boolean
          qq_registration_pending?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          must_change_password?: boolean
          qq_registration_pending?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      resources: {
        Row: {
          author: string
          created_at: string
          created_by: string | null
          current_version: string
          description: string
          external_id: string | null
          game_versions: string[]
          icon_url: string | null
          id: string
          latest_version: string
          loaders: string[]
          name: string
          project_type: string
          project_updated_at: string | null
          resource_type: string
          source: Database["public"]["Enums"]["resource_source"]
          tags: string[]
          update_available: boolean
          update_checked_at: string | null
          updated_at: string
          url: string
        }
        Insert: {
          author?: string
          created_at?: string
          created_by?: string | null
          current_version?: string
          description?: string
          external_id?: string | null
          game_versions?: string[]
          icon_url?: string | null
          id?: string
          latest_version?: string
          loaders?: string[]
          name: string
          project_type?: string
          project_updated_at?: string | null
          resource_type?: string
          source: Database["public"]["Enums"]["resource_source"]
          tags?: string[]
          update_available?: boolean
          update_checked_at?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          author?: string
          created_at?: string
          created_by?: string | null
          current_version?: string
          description?: string
          external_id?: string | null
          game_versions?: string[]
          icon_url?: string | null
          id?: string
          latest_version?: string
          loaders?: string[]
          name?: string
          project_type?: string
          project_updated_at?: string | null
          resource_type?: string
          source?: Database["public"]["Enums"]["resource_source"]
          tags?: string[]
          update_available?: boolean
          update_checked_at?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "resources_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      schematics: {
        Row: {
          author: string
          category: string
          created_at: string
          created_by: string | null
          description: string
          file_name: string
          file_size: number
          id: string
          mime_type: string
          name: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          author: string
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string
          file_name: string
          file_size: number
          id?: string
          mime_type?: string
          name: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          author?: string
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string
          file_name?: string
          file_size?: number
          id?: string
          mime_type?: string
          name?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schematics_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      server_commands: {
        Row: {
          command_type: string
          completed_at: string | null
          id: string
          payload: Json
          requested_at: string
          requested_by: string
          result: Json | null
          server_id: string
          status: Database["public"]["Enums"]["command_status"]
        }
        Insert: {
          command_type: string
          completed_at?: string | null
          id?: string
          payload?: Json
          requested_at?: string
          requested_by: string
          result?: Json | null
          server_id: string
          status?: Database["public"]["Enums"]["command_status"]
        }
        Update: {
          command_type?: string
          completed_at?: string | null
          id?: string
          payload?: Json
          requested_at?: string
          requested_by?: string
          result?: Json | null
          server_id?: string
          status?: Database["public"]["Enums"]["command_status"]
        }
        Relationships: [
          {
            foreignKeyName: "server_commands_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "server_commands_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "game_servers"
            referencedColumns: ["id"]
          },
        ]
      }
      server_metrics: {
        Row: {
          id: number
          memory_used_bytes: number | null
          mspt: number | null
          online_players: number
          sampled_at: string
          server_id: string
          tps: number | null
        }
        Insert: {
          id?: never
          memory_used_bytes?: number | null
          mspt?: number | null
          online_players?: number
          sampled_at?: string
          server_id: string
          tps?: number | null
        }
        Update: {
          id?: never
          memory_used_bytes?: number | null
          mspt?: number | null
          online_players?: number
          sampled_at?: string
          server_id?: string
          tps?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "server_metrics_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "game_servers"
            referencedColumns: ["id"]
          },
        ]
      }
      site_content: {
        Row: {
          content: Json
          id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content?: Json
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content?: Json
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_content_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_cleanup_queue: {
        Row: {
          attempts: number
          bucket_id: string
          created_at: string
          id: number
          last_error: string | null
          locked_at: string | null
          next_attempt_at: string
          object_path: string
          recursive: boolean
          requested_by: string | null
          status: string
        }
        Insert: {
          attempts?: number
          bucket_id: string
          created_at?: string
          id?: never
          last_error?: string | null
          locked_at?: string | null
          next_attempt_at?: string
          object_path: string
          recursive?: boolean
          requested_by?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          bucket_id?: string
          created_at?: string
          id?: never
          last_error?: string | null
          locked_at?: string | null
          next_attempt_at?: string
          object_path?: string
          recursive?: boolean
          requested_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "storage_cleanup_queue_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      town_history: {
        Row: {
          body_en: string
          body_zh: string
          created_at: string
          event_date: string
          id: string
          image_id: string | null
          show_on_home: boolean
          sort_order: number
          title_en: string
          title_zh: string
          updated_at: string
        }
        Insert: {
          body_en?: string
          body_zh: string
          created_at?: string
          event_date: string
          id?: string
          image_id?: string | null
          show_on_home?: boolean
          sort_order?: number
          title_en?: string
          title_zh: string
          updated_at?: string
        }
        Update: {
          body_en?: string
          body_zh?: string
          created_at?: string
          event_date?: string
          id?: string
          image_id?: string | null
          show_on_home?: boolean
          sort_order?: number
          title_en?: string
          title_zh?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "town_history_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "town_images"
            referencedColumns: ["id"]
          },
        ]
      }
      town_announcements: {
        Row: {
          body_en: string
          body_zh: string
          created_at: string
          id: string
          image_id: string | null
          is_visible: boolean
          kind: string
          sort_order: number
          subtitle_en: string
          subtitle_zh: string
          title_en: string
          title_zh: string
          updated_at: string
        }
        Insert: {
          body_en?: string
          body_zh?: string
          created_at?: string
          id?: string
          image_id?: string | null
          is_visible?: boolean
          kind?: string
          sort_order?: number
          subtitle_en?: string
          subtitle_zh?: string
          title_en?: string
          title_zh: string
          updated_at?: string
        }
        Update: {
          body_en?: string
          body_zh?: string
          created_at?: string
          id?: string
          image_id?: string | null
          is_visible?: boolean
          kind?: string
          sort_order?: number
          subtitle_en?: string
          subtitle_zh?: string
          title_en?: string
          title_zh?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "town_announcements_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "town_images"
            referencedColumns: ["id"]
          },
        ]
      }
      town_images: {
        Row: {
          alt_en: string
          alt_zh: string
          area: string
          caption_en: string
          caption_zh: string
          creator_name: string
          created_at: string
          created_by: string | null
          duration_seconds: number | null
          external_id: string | null
          external_url: string | null
          id: string
          is_visible: boolean
          layout: string
          media_type: string
          sort_order: number
          source_url: string
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          alt_en?: string
          alt_zh?: string
          area: string
          caption_en?: string
          caption_zh?: string
          creator_name?: string
          created_at?: string
          created_by?: string | null
          duration_seconds?: number | null
          external_id?: string | null
          external_url?: string | null
          id?: string
          is_visible?: boolean
          layout?: string
          media_type?: string
          sort_order?: number
          source_url: string
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          alt_en?: string
          alt_zh?: string
          area?: string
          caption_en?: string
          caption_zh?: string
          creator_name?: string
          created_at?: string
          created_by?: string | null
          duration_seconds?: number | null
          external_id?: string | null
          external_url?: string | null
          id?: string
          is_visible?: boolean
          layout?: string
          media_type?: string
          sort_order?: number
          source_url?: string
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "town_images_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      town_maps: {
        Row: {
          created_at: string
          created_by: string
          description: string
          id: string
          image_height: number
          image_width: number
          is_visible: boolean
          max_level: number
          name: string
          original_path: string
          short_label: string
          sort_order: number
          storage_prefix: string
          tile_revision: string
          tile_size: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string
          id?: string
          image_height: number
          image_width: number
          is_visible?: boolean
          max_level: number
          name: string
          original_path: string
          short_label?: string
          sort_order?: number
          storage_prefix: string
          tile_revision?: string
          tile_size?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          image_height?: number
          image_width?: number
          is_visible?: boolean
          max_level?: number
          name?: string
          original_path?: string
          short_label?: string
          sort_order?: number
          storage_prefix?: string
          tile_revision?: string
          tile_size?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "town_maps_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      town_members: {
        Row: {
          created_at: string
          id: string
          intro_en: string
          intro_zh: string
          member_group: string
          role_en: string
          role_zh: string
          sort_order: number
          show_on_home: boolean
          updated_at: string
          username: string
          variant: string
        }
        Insert: {
          created_at?: string
          id?: string
          intro_en?: string
          intro_zh?: string
          member_group?: string
          role_en?: string
          role_zh?: string
          sort_order?: number
          show_on_home?: boolean
          updated_at?: string
          username: string
          variant?: string
        }
        Update: {
          created_at?: string
          id?: string
          intro_en?: string
          intro_zh?: string
          member_group?: string
          role_en?: string
          role_zh?: string
          sort_order?: number
          show_on_home?: boolean
          updated_at?: string
          username?: string
          variant?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      commit_town_map_image: {
        Args: {
          p_clear_existing: boolean
          p_image_height: number
          p_image_width: number
          p_map_id: string
          p_max_level: number
          p_original_path: string
          p_storage_prefix: string
          p_tile_revision: string
          p_tile_size: number
        }
        Returns: {
          created_at: string
          created_by: string
          description: string
          id: string
          image_height: number
          image_width: number
          is_visible: boolean
          max_level: number
          name: string
          original_path: string
          short_label: string
          sort_order: number
          storage_prefix: string
          tile_revision: string
          tile_size: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "town_maps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      commit_town_map_image_v2: {
        Args: {
          p_clear_existing: boolean
          p_image_height: number
          p_image_width: number
          p_map_id: string
          p_max_level: number
          p_original_path: string
          p_storage_prefix: string
          p_tile_revision: string
          p_tile_size: number
        }
        Returns: Json
      }
      claim_account_deletion_batch: {
        Args: { p_limit?: number }
        Returns: Database["public"]["Tables"]["account_deletion_queue"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "account_deletion_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_storage_cleanup_batch: {
        Args: { p_limit?: number }
        Returns: Database["public"]["Tables"]["storage_cleanup_queue"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "storage_cleanup_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_resource_stats: {
        Args: never
        Returns: {
          datapack: number
          github: number
          plugin: number
          total: number
          updates: number
        }[]
      }
      get_page_view_analytics: {
        Args: { p_days?: number }
        Returns: Json
      }
      list_account_qq_bindings: {
        Args: never
        Returns: {
          qq_number: string
          user_id: string
          verified_at: string
        }[]
      }
      create_material_project_server: {
        Args: {
          p_actor_id: string
          p_materials: Json
          p_name: string
          p_priority: number
          p_source_date: string
          p_source_title: string
          p_storage_location: string
          p_projection_origin_x: number
          p_projection_origin_y: number
          p_projection_origin_z: number
          p_projection_mirror: string
          p_projection_rotation: number
        }
        Returns: string
      }
      update_material_projection: {
        Args: {
          p_project_id: string
          p_origin_x: number
          p_origin_y: number
          p_origin_z: number
          p_mirror: string
          p_rotation: number
          p_file_name?: string | null
          p_storage_path?: string | null
          p_file_size?: number | null
        }
        Returns: string | null
      }
      get_material_workspace: { Args: never; Returns: Json }
      admin_delete_material_project: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      admin_delete_resource: {
        Args: { p_resource_id: string }
        Returns: undefined
      }
      admin_update_material_project: {
        Args: {
          p_name: string
          p_priority: number
          p_project_id: string
          p_storage_location: string
        }
        Returns: undefined
      }
      admin_update_resource_details: {
        Args: {
          p_description: string
          p_name: string
          p_resource_id: string
        }
        Returns: undefined
      }
      list_public_resource_previews: {
        Args: never
        Returns: {
          author: string
          created_at: string
          created_by: string | null
          current_version: string
          description: string
          external_id: string | null
          game_versions: string[]
          icon_url: string | null
          id: string
          latest_version: string
          loaders: string[]
          name: string
          project_type: string
          project_updated_at: string | null
          resource_type: string
          source: Database["public"]["Enums"]["resource_source"]
          tags: string[]
          update_available: boolean
          update_checked_at: string | null
          updated_at: string
          url: string
        }[]
        SetofOptions: {
          from: "*"
          to: "resources"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_forum_posts: {
        Args: {
          p_author_id?: string | null
          p_kind?: string | null
          p_limit?: number
          p_offset?: number
        }
        Returns: {
          author_id: string | null
          author_username: string
          body: string
          created_at: string
          id: string
          kind: string
          title: string
          updated_at: string
        }[]
      }
      list_map_owners: {
        Args: never
        Returns: {
          id: string
          must_change_password: boolean
          role: Database["public"]["Enums"]["app_role"]
          username: string
        }[]
      }
      list_resource_loaders: {
        Args: never
        Returns: {
          loader: string
        }[]
      }
      mark_password_changed: { Args: never; Returns: undefined }
      prepare_account_deletion: {
        Args: { p_actor_id: string; p_target_id: string }
        Returns: Json
      }
      queue_own_storage_cleanup: {
        Args: { p_bucket: string; p_path: string }
        Returns: undefined
      }
      queue_shared_file_deletion: {
        Args: { p_file_id: string }
        Returns: undefined
      }
      queue_town_image_deletion: {
        Args: { p_image_id: string }
        Returns: undefined
      }
      prune_operation_logs: { Args: never; Returns: number }
      record_page_view: {
        Args: {
          p_authenticated?: boolean
          p_masked_ip?: string | null
          p_visitor_digest?: string | null
        }
        Returns: undefined
      }
      replace_faq_items: { Args: { items: Json }; Returns: undefined }
      replace_town_announcements: { Args: { items: Json }; Returns: undefined }
      replace_town_history: { Args: { items: Json }; Returns: undefined }
      replace_town_members: { Args: { items: Json }; Returns: undefined }
      resolve_profile_id: { Args: { login_username: string }; Returns: string }
      save_map_claim: {
        Args: {
          p_cells: Json
          p_claim_id: string | null
          p_color: string
          p_description: string
          p_map_id: string
          p_minecraft_username: string
          p_owner_id?: string
          p_project_name: string
          p_status: string
        }
        Returns: Json
      }
      set_material_claim: {
        Args: { p_amount: number; p_item_id: string; p_note: string }
        Returns: string | null
      }
      set_material_claims: {
        Args: { p_amounts: number[] | null; p_item_ids: string[]; p_note: string }
        Returns: number
      }
      set_material_claim_completed: {
        Args: { p_assignment_id: string; p_completed: boolean; p_note?: string }
        Returns: undefined
      }
      set_material_claims_completed: {
        Args: { p_assignment_ids: string[]; p_completed: boolean; p_note?: string }
        Returns: number
      }
      update_material_project: {
        Args: { p_priority: number; p_project_id: string; p_storage_location: string }
        Returns: undefined
      }
      update_resource_check: {
        Args: {
          p_checked_at: string
          p_latest_version: string
          p_resource_id: string
          p_update_available: boolean
        }
        Returns: undefined
      }
      update_own_username: {
        Args: { next_username: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "member" | "viewer"
      command_status: "pending" | "sent" | "succeeded" | "failed" | "expired"
      resource_source: "modrinth" | "github" | "minecraft"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "admin", "member", "viewer"],
      command_status: ["pending", "sent", "succeeded", "failed", "expired"],
      resource_source: ["modrinth", "github", "minecraft"],
    },
  },
} as const
