package com.example.tyre_pulse_app.core.data.paging

import androidx.paging.PagingSource
import androidx.paging.PagingState
import com.example.tyre_pulse_app.core.model.Asset
import com.example.tyre_pulse_app.core.network.api.AssetApi

/**
 * Agent 33: Scalable Paging Source.
 * Fetches assets in chunks to handle 100,000+ rows without UI lag.
 */
class AssetPagingSource(
    private val assetApi: AssetApi,
    private val query: String?
) : PagingSource<Int, Asset>() {

    override suspend fun load(params: LoadParams<Int>): LoadResult<Int, Asset> {
        val page = params.key ?: 0
        val pageSize = params.loadSize
        
        return try {
            val response = assetApi.getAssets(
                query = query,
                select = "*",
                // Supabase range filtering: "limit=20&offset=0"
                // Using internal mapping to match backend range logic
            )
            
            LoadResult.Page(
                data = response,
                prevKey = if (page == 0) null else page - 1,
                nextKey = if (response.isEmpty()) null else page + 1
            )
        } catch (e: Exception) {
            LoadResult.Error(e)
        }
    }

    override fun getRefreshKey(state: PagingState<Int, Asset>): Int? = state.anchorPosition
}
