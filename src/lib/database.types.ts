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
            foreignKeyName: "map_claim_cells_claim_map_foreign_key"
            columns: ["claim_id", "map_id"]
            isOneToOne: false
            referencedRelation: "map_claims"
            referencedColumns: ["id", "map_id"]
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
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          id: string
          must_change_password?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          must_change_password?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          username?: string
        }
        Relationships: []
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
      get_page_view_analytics: {
        Args: { p_days?: number }
        Returns: Json
      }
      // 按待应用的 20261020041649 迁移同步；部署后用 CLI 再生成核对。
      get_map_claim_detail: {
        Args: { p_map_id: string; p_claim_id: string }
        Returns: Json
      }
      list_map_claim_summaries: {
        Args: {
          p_map_id: string
          p_query?: string
          p_offset?: number
          p_limit?: number
        }
        Returns: Json
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
      mark_password_changed: { Args: never; Returns: undefined }
      prepare_account_deletion: {
        Args: { p_actor_id: string; p_target_id: string }
        Returns: Json
      }
      queue_own_storage_cleanup: {
        Args: { p_bucket: string; p_path: string }
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
        }
        Returns: Json
      }
      update_own_username: {
        Args: { next_username: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "member" | "viewer"
      command_status: "pending" | "sent" | "succeeded" | "failed" | "expired"
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
    },
  },
} as const
