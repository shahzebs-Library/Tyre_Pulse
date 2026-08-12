package com.example.tyre_pulse_app.feature.assets.data

import androidx.paging.PagingSource
import androidx.paging.PagingState
import com.example.tyre_pulse_app.core.model.Asset
import com.example.tyre_pulse_app.core.network.api.AssetApi

class AssetPagingSource(
    private val assetApi: AssetApi,
    private val query: String?
) : PagingSource<Int, Asset>() {

    override suspend fun load(params: LoadParams<Int>): LoadResult<Int, Asset> {
        val page = params.key ?: 0
        val pageSize = params.loadSize
        
        return try {
            // PostgREST Range header: "0-19"
            val range = "${page * pageSize}-${(page + 1) * pageSize - 1}"
            val results = assetApi.getAssets(range = range, assetNumber = query?.let { "ilike.*$it*" })
            
            LoadResult.Page(
                data = results,
                prevKey = if (page == 0) null else page - 1,
                nextKey = if (results.isEmpty()) null else page + 1
            )
        } catch (e: Exception) {
            LoadResult.Error(e)
        }
    }

    override fun getRefreshKey(state: PagingState<Int, Asset>): Int? {
        return state.anchorPosition?.let { anchorPosition ->
            state.closestPageToPosition(anchorPosition)?.prevKey?.plus(1)
                ?: state.closestPageToPosition(anchorPosition)?.nextKey?.minus(1)
        }
    }
}
